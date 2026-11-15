//By leewheel 2026年11月15日 启动器独立更新器（Update.exe）
// 目的：把「启动器替换自己」这件事从启动器进程里彻底剥离，做成一个独立小 exe。
//
// 为什么原来的做法不稳（结构性原因，不是重试次数不够）：
//  启动器是 electron-builder 的 portable 打包。玩家双击的 CoA启动器.exe 只是自解压外壳，
//  真正在跑的是 %TEMP%\CoALauncherLite-*\CoA启动器.exe。外壳进程要等内层退出、清理完临时目录才会结束，
//  而这期间它一直映射着 CoA启动器.exe —— 原来「等内层 PID 退出 → 立刻改名」必然撞文件占用；
//  等外壳清理完（375MB 解压目录）再改，restart 又会跟外壳的同名目录清理撞车。
//  所以「偶尔能成、多数超时」是必然结果。
//
// 本程序的做法（对应老大 2026-11-15 的要求：独立 Update.exe + 强杀 + 等彻底关闭 + 新旧替换）：
//   1) 按**映像完整路径**精确找出目标 exe 的所有进程（外壳 + 内层 + electron 子进程），连同子进程树强杀；
//   2) 用「能否以独占方式打开目标文件」作为句柄确实释放的判据 —— 而不是猜 PID 是谁；
//   3) 自己用 WinHTTP 下载到 <root>\Update\ 下（支持断点续传、多源重试），BCrypt 校验 SHA256；
//   4) 校验通过才替换：目标改名 .old.exe → 新文件改名成目标 → 失败回滚，绝不留下没有启动器的现场；
//   5) 需要时重启启动器。
//
// 用法：
//   Update.exe --target <CoA启动器.exe 全路径> [--root <安装根>] [--pid <启动器PID>]
//              (--url <下载地址> --sha256 <HEX> [--size <字节>] | --staged <已下载的新exe>)
//              [--version <版本号>] [--restart 1|0] [--wait-ms 1500] [--kill-ms 60000]
//
// 退出码：0 成功 / 2 参数不足 / 3 杀进程失败 / 4 下载失败 / 5 校验失败 / 6 替换失败
// 日志：<root>\Update\update.log（UTF-8，追加）
//End By leewheel
#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <wchar.h>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "advapi32.lib")

#define MAXP 4096

static HANDLE g_log = INVALID_HANDLE_VALUE;
static wchar_t g_logPath[MAXP];

/* ---------------------------------------------------------------- 日志 */

static void logOpen(const wchar_t* path) {
    wcscpy_s(g_logPath, MAXP, path);
    g_log = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                        NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
}

static void logLine(const wchar_t* fmt, ...) {
    wchar_t text[4096];
    va_list args;
    va_start(args, fmt);
    _vsnwprintf_s(text, 4096, _TRUNCATE, fmt, args);
    va_end(args);

    SYSTEMTIME st;
    GetLocalTime(&st);
    wchar_t line[4600];
    _snwprintf_s(line, 4600, _TRUNCATE, L"[%04d-%02d-%02d %02d:%02d:%02d] %ls\r\n",
                 st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, text);

    if (g_log != INVALID_HANDLE_VALUE) {
        char utf8[9216];
        int n = WideCharToMultiByte(CP_UTF8, 0, line, -1, utf8, sizeof(utf8), NULL, NULL);
        if (n > 1) {
            DWORD written = 0;
            SetFilePointer(g_log, 0, NULL, FILE_END);
            WriteFile(g_log, utf8, (DWORD)(n - 1), &written, NULL);
            FlushFileBuffers(g_log);
        }
    }
}

/* ------------------------------------------------------------ 路径工具 */

static BOOL fileExists(const wchar_t* path) {
    DWORD attr = GetFileAttributesW(path);
    return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

static __int64 fileSize(const wchar_t* path) {
    WIN32_FILE_ATTRIBUTE_DATA data;
    if (!GetFileAttributesExW(path, GetFileExInfoStandard, &data)) return -1;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return -1;
    return ((__int64)data.nFileSizeHigh << 32) | data.nFileSizeLow;
}

/** 目录部分（含结尾反斜杠）；正反斜杠都要认 ——
 *  调用方可能传 "G:/xxx/CoA启动器.exe" 这种正斜杠写法（外面脚本传参就会这样），
 *  只认反斜杠会把 root 解析成空串，日志与下载就落到当前工作目录去了。 */
static void dirOf(const wchar_t* path, wchar_t* out, size_t cch) {
    wcscpy_s(out, cch, path);
    wchar_t* slash = wcsrchr(out, L'\\');
    wchar_t* forward = wcsrchr(out, L'/');
    if (forward && (!slash || forward > slash)) slash = forward;
    if (!slash) { out[0] = 0; return; }
    slash[1] = 0;
}

/** 在 target 同目录生成 “名字.old.exe”：去 .exe 再拼，避免 CoA启动器.exe.old.exe 这种别扭名字 */
static void legacyNameOf(const wchar_t* target, wchar_t* out, size_t cch) {
    wcscpy_s(out, cch, target);
    size_t len = wcslen(out);
    if (len > 4 && _wcsicmp(out + len - 4, L".exe") == 0) out[len - 4] = 0;
    wcscat_s(out, cch, L".old.exe");
}

/** 目录是否存在；不存在则创建（逐级） */
static BOOL ensureDir(const wchar_t* dir) {
    if (!dir || !dir[0]) return FALSE;
    if (GetFileAttributesW(dir) != INVALID_FILE_ATTRIBUTES) return TRUE;
    wchar_t tmp[MAXP];
    wcscpy_s(tmp, MAXP, dir);
    size_t len = wcslen(tmp);
    if (len && (tmp[len - 1] == L'\\' || tmp[len - 1] == L'/')) tmp[len - 1] = 0;
    for (wchar_t* p = tmp + 3; *p; p++) {
        if (*p == L'\\' || *p == L'/') {
            wchar_t hold = *p;
            *p = 0;
            CreateDirectoryW(tmp, NULL);
            *p = hold;
        }
    }
    return CreateDirectoryW(tmp, NULL) != 0 || GetLastError() == ERROR_ALREADY_EXISTS;
}

/** 目标文件此刻能否以独占方式打开 —— 这是「句柄真的释放了」的唯一可靠判据 */
static BOOL canOpenExclusive(const wchar_t* path) {
    if (!fileExists(path)) return TRUE;      // 不存在就是没人占用
    HANDLE h = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return FALSE;
    CloseHandle(h);
    return TRUE;
}

/* -------------------------------------------------------------- 参数 */

typedef struct {
    wchar_t target[MAXP];    // CoA启动器.exe 全路径
    wchar_t root[MAXP];      // 安装根
    wchar_t url[2048];
    wchar_t sha256[80];
    wchar_t version[64];
    wchar_t staged[MAXP];    // 已经下好的新 exe（可选）
    wchar_t proxy[256];      // 手动代理 host:port（可选，优先于系统代理）
    BOOL noProxy;            // 强制直连
    __int64 size;
    DWORD pid;
    BOOL restart;
    DWORD waitMs;
    DWORD killMs;
} Options;

static const wchar_t* argValue(int argc, wchar_t** argv, const wchar_t* name) {
    size_t len = wcslen(name);
    for (int i = 1; i < argc; i++) {
        if (_wcsnicmp(argv[i], name, len) == 0 && (argv[i][len] == L'=' || argv[i][len] == 0)) {
            if (argv[i][len] == L'=') return argv[i] + len + 1;
            if (i + 1 < argc) return argv[i + 1];
            return L"";
        }
    }
    return NULL;
}

/* ---------------------------------------------------------- 进程清理 */

typedef struct { DWORD pid; DWORD ppid; } ProcEntry;

static int snapshot(ProcEntry* list, int cap) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W entry;
    entry.dwSize = sizeof(entry);
    int count = 0;
    if (Process32FirstW(snap, &entry)) {
        do {
            if (count < cap) {
                list[count].pid = entry.th32ProcessID;
                list[count].ppid = entry.th32ParentProcessID;
                count++;
            }
        } while (Process32NextW(snap, &entry));
    }
    CloseHandle(snap);
    return count;
}

static BOOL imagePathOf(DWORD pid, wchar_t* out, DWORD cch) {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
    if (!h) return FALSE;
    DWORD size = cch;
    BOOL ok = QueryFullProcessImageNameW(h, 0, out, &size);
    CloseHandle(h);
    return ok;
}

static BOOL isAlive(DWORD pid) {
    if (!pid) return FALSE;
    HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!h) return FALSE;
    DWORD waited = WaitForSingleObject(h, 0);
    CloseHandle(h);
    return waited == WAIT_TIMEOUT;
}

static void terminatePid(DWORD pid) {
    HANDLE h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
    if (!h) return;
    TerminateProcess(h, 1);
    WaitForSingleObject(h, 5000);
    CloseHandle(h);
}

/**
 * 强杀启动器整棵进程树。
 * 匹配规则（都按**映像完整路径**，不靠 PID 猜）：
 *   a) 路径 == target（portable 外壳）
 *   b) 路径在 %TEMP%\CoALauncherLite-*\ 下（解压出来的内层 exe 与 electron 子进程）
 *   c) 父进程命中 a/b 的（子进程继承）
 * 永远跳过自己（Update.exe）。
 */
static int killLauncher(const wchar_t* target, DWORD knownPid, DWORD timeoutMs) {
    wchar_t tempDir[MAXP] = {0};
    DWORD tlen = GetTempPathW(MAXP, tempDir);

    static ProcEntry procs[MAXP];
    int killed = 0;
    DWORD selfPid = GetCurrentProcessId();
    wchar_t selfPath[MAXP] = {0};
    imagePathOf(selfPid, selfPath, MAXP);

    for (int round = 0; round < 400; round++) {
        // 每轮重新扫：electron 会派生 helper，外壳也可能被玩家重新点开
        int n = snapshot(procs, MAXP);
        int hitThisRound = 0;

        // 先标出命中 a/b 的进程
        BOOL mark[MAXP] = {0};
        for (int i = 0; i < n; i++) {
            DWORD pid = procs[i].pid;
            if (pid == selfPid || pid == 0) continue;
            wchar_t path[MAXP] = {0};
            if (!imagePathOf(pid, path, MAXP)) continue;
            if (selfPath[0] && _wcsicmp(path, selfPath) == 0) continue;   // 别杀自己
            BOOL hit = FALSE;
            if (target[0] && _wcsicmp(path, target) == 0) hit = TRUE;
            if (!hit && tlen > 0 && _wcsnicmp(path, tempDir, tlen) == 0 &&
                (wcsstr(path, L"CoALauncherLite") || wcsstr(path, L"CoABotsLite"))) hit = TRUE;
            if (!hit && knownPid && pid == knownPid) hit = TRUE;
            if (hit) mark[i] = TRUE;
        }

        // 再把他们派生的子进程一并标出来（一层就够：electron helper 都是直接子进程）
        for (int i = 0; i < n; i++) {
            if (mark[i]) continue;
            for (int j = 0; j < n; j++) {
                if (mark[j] && procs[i].ppid == procs[j].pid) { mark[i] = TRUE; break; }
            }
        }

        for (int i = 0; i < n; i++) {
            if (!mark[i]) continue;
            DWORD pid = procs[i].pid;
            if (pid == selfPid) continue;
            wchar_t path[MAXP] = {0};
            imagePathOf(pid, path, MAXP);
            terminatePid(pid);
            logLine(L"[kill] 终止进程 pid=%lu path=%ls", pid, path[0] ? path : L"(未知)");
            killed++;
            hitThisRound++;
        }

        if (!hitThisRound) break;
        Sleep(300);
    }

    // 等句柄真正释放：文件能独占打开才算“老进程彻底关闭”（老大原话的判据）
    ULONGLONG start = GetTickCount64();
    while (GetTickCount64() - start < timeoutMs) {
        if (canOpenExclusive(target)) {
            logLine(L"[kill] 目标文件已无占用（清理了 %d 个进程，用时 %llu ms）",
                    killed, GetTickCount64() - start);
            return 0;
        }
        Sleep(200);
    }
    logLine(L"[kill] 等待目标文件释放超时（%lu ms），仍被占用", timeoutMs);
    return -1;
}

/* ------------------------------------------------------------ SHA256 */

static BOOL sha256OfFile(const wchar_t* path, wchar_t* out, size_t cch) {
    BCRYPT_ALG_HANDLE alg = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    BOOL ok = FALSE;
    DWORD hashLen = 0, got = 0;
    BYTE* hashObj = NULL;
    BYTE digest[32];

    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (file == INVALID_HANDLE_VALUE) return FALSE;

    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) goto done;
    if (BCryptGetProperty(alg, BCRYPT_OBJECT_LENGTH, (PUCHAR)&hashLen, sizeof(hashLen), &got, 0) != 0) goto done;
    hashObj = (BYTE*)HeapAlloc(GetProcessHeap(), 0, hashLen);
    if (!hashObj) goto done;
    if (BCryptCreateHash(alg, &hash, hashObj, hashLen, NULL, 0, 0) != 0) goto done;

    {
        BYTE buffer[1 << 16];
        DWORD read = 0;
        for (;;) {
            if (!ReadFile(file, buffer, sizeof(buffer), &read, NULL)) goto done;
            if (read == 0) break;
            if (BCryptHashData(hash, buffer, read, 0) != 0) goto done;
        }
    }

    if (BCryptFinishHash(hash, digest, 32, 0) != 0) goto done;
    for (int i = 0; i < 32; i++) swprintf_s(out + i * 2, cch - i * 2, L"%02x", digest[i]);
    ok = TRUE;

done:
    if (hash) BCryptDestroyHash(hash);
    if (alg) BCryptCloseAlgorithmProvider(alg, 0);
    if (hashObj) HeapFree(GetProcessHeap(), 0, hashObj);
    CloseHandle(file);
    return ok;
}

/* ------------------------------------------------------------- 下载 */

typedef struct {
    const wchar_t* url;
    const wchar_t* dest;
    const wchar_t* expectSha;
    __int64 expectSize;
} DownloadJob;

/**
 * 把系统（IE/WinINET）代理配置套到 WinHTTP 会话上。
 * 🔴 必须做：WINHTTP_ACCESS_TYPE_DEFAULT_PROXY 用的是 **WinHTTP 自己的**代理配置（默认“直连”），
 * 不读 IE/WinINET 的设置。实测本机 raw.githubusercontent.com 直连返回 000（被墙），
 * 走系统代理 127.0.0.1:7897 才是 200 —— 不套这一步，没配过 WinHTTP 代理的玩家一辈子下不动。
 * 顺序：PAC(自动配置脚本) → 自动探测 → 固定代理；都不行就直连。
 */
static BOOL applySystemProxy(HINTERNET session, const wchar_t* url, const Options* opt) {
    if (opt->noProxy) {
        logLine(L"[http] 按参数要求直连，不使用代理");
        return FALSE;
    }

    // 1) 命令行指定的代理优先
    if (opt->proxy[0]) {
        WINHTTP_PROXY_INFO info;
        ZeroMemory(&info, sizeof(info));
        info.dwAccessType = WINHTTP_ACCESS_TYPE_NAMED_PROXY;
        info.lpszProxy = (LPWSTR)opt->proxy;
        if (WinHttpSetOption(session, WINHTTP_OPTION_PROXY, &info, sizeof(info))) {
            logLine(L"[http] 使用命令行代理 %ls", opt->proxy);
            return TRUE;
        }
        logLine(L"[http] 命令行代理设置失败 %lu", GetLastError());
    }

    WINHTTP_CURRENT_USER_IE_PROXY_CONFIG cfg;
    ZeroMemory(&cfg, sizeof(cfg));
    if (!WinHttpGetIEProxyConfigForCurrentUser(&cfg)) {
        logLine(L"[http] 读不到系统代理配置 %lu，按直连处理", GetLastError());
        return FALSE;
    }

    WINHTTP_PROXY_INFO info;
    ZeroMemory(&info, sizeof(info));
    BOOL ok = FALSE;

    if (cfg.lpszAutoConfigUrl && cfg.lpszAutoConfigUrl[0]) {
        WINHTTP_AUTOPROXY_OPTIONS opts;
        ZeroMemory(&opts, sizeof(opts));
        opts.dwFlags = WINHTTP_AUTOPROXY_CONFIG_URL;
        opts.dwAutoDetectFlags = 0;
        opts.lpszAutoConfigUrl = cfg.lpszAutoConfigUrl;
        opts.fAutoLogonIfChallenged = TRUE;
        ok = WinHttpGetProxyForUrl(session, url, &opts, &info);
        logLine(L"[http] PAC 自动配置：%ls → %ls", cfg.lpszAutoConfigUrl, ok ? L"已解析" : L"解析失败，改用固定代理");
    }

    if (!ok && cfg.fAutoDetect) {
        WINHTTP_AUTOPROXY_OPTIONS opts;
        ZeroMemory(&opts, sizeof(opts));
        opts.dwFlags = WINHTTP_AUTOPROXY_AUTO_DETECT;
        opts.dwAutoDetectFlags = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
        opts.fAutoLogonIfChallenged = TRUE;
        ok = WinHttpGetProxyForUrl(session, url, &opts, &info);
    }

    if (!ok && cfg.lpszProxy && cfg.lpszProxy[0]) {
        info.dwAccessType = WINHTTP_ACCESS_TYPE_NAMED_PROXY;
        info.lpszProxy = cfg.lpszProxy;
        info.lpszProxyBypass = cfg.lpszProxyBypass;
        ok = TRUE;
        logLine(L"[http] 使用系统固定代理 %ls（例外：%ls）", cfg.lpszProxy,
                cfg.lpszProxyBypass && cfg.lpszProxyBypass[0] ? cfg.lpszProxyBypass : L"无");
    }

    if (ok) {
        if (!WinHttpSetOption(session, WINHTTP_OPTION_PROXY, &info, sizeof(info))) {
            logLine(L"[http] 应用代理失败 %lu，按直连处理", GetLastError());
            ok = FALSE;
        }
    } else if (!cfg.lpszAutoConfigUrl && !cfg.fAutoDetect && !(cfg.lpszProxy && cfg.lpszProxy[0])) {
        logLine(L"[http] 系统没有配置代理，直连");
    }

    if (cfg.lpszAutoConfigUrl) GlobalFree(cfg.lpszAutoConfigUrl);
    if (cfg.lpszProxy) GlobalFree(cfg.lpszProxy);
    if (cfg.lpszProxyBypass) GlobalFree(cfg.lpszProxyBypass);
    return ok;
}

static BOOL downloadOnce(const DownloadJob* job, const Options* opt, DWORD* outStatus, const wchar_t* partFile) {
    URL_COMPONENTS uc;
    ZeroMemory(&uc, sizeof(uc));
    uc.dwStructSize = sizeof(uc);

    wchar_t host[512] = {0};
    wchar_t object[2048] = {0};
    uc.lpszHostName = host;   uc.dwHostNameLength = 511;
    uc.lpszUrlPath = object;  uc.dwUrlPathLength = 2047;

    if (!WinHttpCrackUrl(job->url, 0, 0, &uc)) {
        logLine(L"[http] 地址解析失败：%ls", job->url);
        return FALSE;
    }

    // 主机名可能不带端口；nPort 在 scheme 默认时是 80/443，直接用
    HINTERNET session = WinHttpOpen(L"CoA-Launcher-Update/1.0",
                                    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) { logLine(L"[http] WinHttpOpen 失败 %lu", GetLastError()); return FALSE; }
    // 连接 10s / 发送 30s / 接收 30s：接收超时是「两次收到数据之间」的空闲上限，
    // 390MB 的包在慢网下也不会被误判；但连不上时能快速失败，不让玩家干等几分钟。
    WinHttpSetTimeouts(session, 10000, 30000, 30000, 30000);

    // 套系统代理（见 applySystemProxy 上的说明：不套这一步国内玩家下不动 GitHub）
    applySystemProxy(session, job->url, opt);

    HINTERNET connect = WinHttpConnect(session, host, uc.nPort, 0);
    if (!connect) { logLine(L"[http] 连接 %ls 失败 %lu", host, GetLastError()); WinHttpCloseHandle(session); return FALSE; }

    DWORD flags = (uc.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET request = WinHttpOpenRequest(connect, L"GET", object, NULL,
                                           WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!request) { logLine(L"[http] 建请求失败 %lu", GetLastError()); WinHttpCloseHandle(connect); WinHttpCloseHandle(session); return FALSE; }

    // GitHub Release 资产会 302 到 objects.githubusercontent.com，必须允许跟随
    DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
    WinHttpSetOption(request, WINHTTP_OPTION_REDIRECT_POLICY, &policy, sizeof(policy));
    // 旧系统默认协议可能不含 TLS1.2 —— 只在 https 上设
    if (flags & WINHTTP_FLAG_SECURE) {
        DWORD protocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
        WinHttpSetOption(request, WINHTTP_OPTION_SECURE_PROTOCOLS, &protocols, sizeof(protocols));
    }

    __int64 have = fileSize(partFile);
    if (have < 0) have = 0;
    if (have > 0) {
        wchar_t range[128];
        _snwprintf_s(range, 128, _TRUNCATE, L"Range: bytes=%lld-", have);
        WinHttpAddRequestHeaders(request, range, (DWORD)-1L, WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
        logLine(L"[http] 断点续传，从 %lld 字节继续", have);
    }

    BOOL ok = FALSE;
    HINTERNET redirected = NULL;
    if (!WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, NULL, 0, 0, 0)) {
        logLine(L"[http] 发送请求失败 %lu", GetLastError());
        goto done;
    }
    if (!WinHttpReceiveResponse(request, NULL)) {
        logLine(L"[http] 接收响应失败 %lu", GetLastError());
        goto done;
    }

    {
        DWORD status = 0, len = sizeof(status);
        WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &status, &len, WINHTTP_NO_HEADER_INDEX);
        *outStatus = status;
        if (status != 200 && status != 206) {
            logLine(L"[http] 服务器返回 %lu（%ls）", status, job->url);
            goto done;
        }
        // 服务器不认 Range（返回 200）就从 0 重写
        if (status == 200 && have > 0) { have = 0; }
    }

    {
        HANDLE file = CreateFileW(partFile, GENERIC_WRITE, 0, NULL,
                                  have > 0 ? OPEN_ALWAYS : CREATE_ALWAYS,
                                  FILE_ATTRIBUTE_NORMAL, NULL);
        if (file == INVALID_HANDLE_VALUE) {
            logLine(L"[http] 打不开临时文件 %ls（%lu）", partFile, GetLastError());
            goto done;
        }
        if (have > 0) {
            LARGE_INTEGER pos; pos.QuadPart = have;
            SetFilePointerEx(file, pos, NULL, FILE_BEGIN);
            SetEndOfFile(file);
        }

        __int64 total = have;
        ULONGLONG lastLog = GetTickCount64();
        BYTE buffer[1 << 16];
        for (;;) {
            DWORD read = 0;
            if (!WinHttpReadData(request, buffer, sizeof(buffer), &read)) {
                logLine(L"[http] 读数据失败 %lu（已下 %lld 字节）", GetLastError(), total);
                CloseHandle(file);
                goto done;
            }
            if (read == 0) break;
            DWORD written = 0;
            if (!WriteFile(file, buffer, read, &written, NULL) || written != read) {
                logLine(L"[http] 写文件失败 %lu", GetLastError());
                CloseHandle(file);
                goto done;
            }
            total += read;
            if (GetTickCount64() - lastLog > 3000) {
                lastLog = GetTickCount64();
                logLine(L"[http] 已下载 %lld 字节", total);
            }
        }
        CloseHandle(file);
        logLine(L"[http] 下载完成，共 %lld 字节", total);
        ok = TRUE;
    }

done:
    if (redirected) WinHttpCloseHandle(redirected);
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return ok;
}

/** 下载 → 校验大小 → 校验 SHA256。返回最终文件路径（放 *_out） */
static BOOL fetchNewExe(const Options* opt, const wchar_t* dest, wchar_t* out, size_t cch) {
    wchar_t part[MAXP];
    _snwprintf_s(part, MAXP, _TRUNCATE, L"%ls.part", dest);

    DownloadJob job = { opt->url, dest, opt->sha256, opt->size };
    DWORD status = 0;
    for (int attempt = 1; attempt <= 3; attempt++) {
        logLine(L"[http] 第 %d 次尝试下载：%ls", attempt, opt->url);
        if (downloadOnce(&job, opt, &status, part)) break;
        if (attempt == 3) { logLine(L"[http] 三次下载都失败"); return FALSE; }
        Sleep(1500);
    }

    __int64 size = fileSize(part);
    if (size <= 0) { logLine(L"[chk] 下载文件为空"); return FALSE; }
    if (opt->size > 0 && size != opt->size) {
        logLine(L"[chk] 大小不符：期望 %lld，实际 %lld —— 丢弃重下", opt->size, size);
        DeleteFileW(part);
        return FALSE;
    }

    if (opt->sha256[0]) {
        wchar_t actual[80] = {0};
        if (!sha256OfFile(part, actual, 80)) { logLine(L"[chk] 算不出 SHA256"); return FALSE; }
        logLine(L"[chk] SHA256 期望=%ls 实际=%ls", opt->sha256, actual);
        if (_wcsicmp(actual, opt->sha256) != 0) {
            logLine(L"[chk] SHA256 不匹配，删除坏文件");
            DeleteFileW(part);
            return FALSE;
        }
    }

    DeleteFileW(dest);
    if (!MoveFileExW(part, dest, MOVEFILE_REPLACE_EXISTING)) {
        logLine(L"[chk] 改名失败 %lu", GetLastError());
        return FALSE;
    }
    wcscpy_s(out, cch, dest);
    return TRUE;
}

/* ------------------------------------------------------------ 替换 */

/** 目标改名 .old.exe → 新文件改名成目标；失败回滚，绝不留下没有启动器的现场 */
static BOOL swapInto(const wchar_t* newFile, const wchar_t* target, DWORD timeoutMs) {
    wchar_t legacy[MAXP];
    legacyNameOf(target, legacy, MAXP);

    ULONGLONG start = GetTickCount64();
    int round = 0;
    for (;;) {
        round++;
        // 上一轮备份先清掉；清不掉就换个名字，别挡住这次替换
        if (!DeleteFileW(legacy)) {
            wchar_t alt[MAXP];
            _snwprintf_s(alt, MAXP, _TRUNCATE, L"%ls.%lu.old.exe", target, GetTickCount());
            MoveFileExW(legacy, alt, MOVEFILE_REPLACE_EXISTING);
        }

        if (MoveFileExW(target, legacy, MOVEFILE_REPLACE_EXISTING)) {
            if (MoveFileExW(newFile, target, MOVEFILE_REPLACE_EXISTING)) {
                logLine(L"[swap] 替换成功（第 %d 次尝试）", round);
                return TRUE;
            }
            logLine(L"[swap] 新文件就位失败 %lu，回滚", GetLastError());
            MoveFileExW(legacy, target, MOVEFILE_REPLACE_EXISTING);
            return FALSE;
        }

        if (round == 1) logLine(L"[swap] 目标改名失败 %lu，每 300ms 重试", GetLastError());
        if (GetTickCount64() - start > timeoutMs) {
            logLine(L"[swap] 重试超时（%lu ms），放弃；旧启动器保持不动", timeoutMs);
            return FALSE;
        }
        Sleep(300);
    }
}

static void restartLauncher(const wchar_t* target, const wchar_t* workdir) {
    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));
    if (CreateProcessW(target, NULL, NULL, NULL, FALSE, 0, NULL,
                       workdir[0] ? workdir : NULL, &si, &pi)) {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        logLine(L"[run] 已重启启动器");
    } else {
        logLine(L"[run] 重启失败 %lu（玩家手动双击即可）", GetLastError());
    }
}

/* -------------------------------------------------------------- main */

int wmain(int argc, wchar_t** argv) {
    Options opt;
    ZeroMemory(&opt, sizeof(opt));
    opt.waitMs = 1500;
    opt.killMs = 60000;
    opt.restart = TRUE;
    opt.size = -1;

    const wchar_t* target = argValue(argc, argv, L"--target");
    if (!target || !target[0]) return 2;
    wcscpy_s(opt.target, MAXP, target);

    const wchar_t* root = argValue(argc, argv, L"--root");
    if (root && root[0]) wcscpy_s(opt.root, MAXP, root);
    else dirOf(opt.target, opt.root, MAXP);

    // 日志落在 <root>\Update\update.log
    // 🔴 root 可能不带结尾分隔符（启动器传的是 path.join 的结果，形如 G:\xxx\COA-PUBLISH-REPACK），
    //    直接拼 "Update" 会得到 G:\xxx\COA-PUBLISH-REPACKUpdate —— 必须自己补分隔符。
    wchar_t updateDir[MAXP];
    {
        size_t rl = wcslen(opt.root);
        BOOL tail = rl > 0 && (opt.root[rl - 1] == L'\\' || opt.root[rl - 1] == L'/');
        _snwprintf_s(updateDir, MAXP, _TRUNCATE, L"%ls%lsUpdate", opt.root, tail ? L"" : L"\\");
    }
    ensureDir(updateDir);
    _snwprintf_s(g_logPath, MAXP, _TRUNCATE, L"%ls\\update.log", updateDir);
    logOpen(g_logPath);

    logLine(L"======== Update.exe 启动 ========");
    logLine(L"[arg] target=%ls root=%ls", opt.target, opt.root);

    const wchar_t* v = argValue(argc, argv, L"--pid");
    if (v && v[0]) opt.pid = (DWORD)_wtoi(v);
    v = argValue(argc, argv, L"--url"); if (v) wcscpy_s(opt.url, 2048, v);
    v = argValue(argc, argv, L"--sha256"); if (v) wcscpy_s(opt.sha256, 80, v);
    v = argValue(argc, argv, L"--size"); if (v && v[0]) opt.size = _wtoi64(v);
    v = argValue(argc, argv, L"--version"); if (v) wcscpy_s(opt.version, 64, v);
    v = argValue(argc, argv, L"--staged"); if (v) wcscpy_s(opt.staged, MAXP, v);
    v = argValue(argc, argv, L"--proxy"); if (v) wcscpy_s(opt.proxy, 256, v);
    if (argValue(argc, argv, L"--no-proxy")) opt.noProxy = TRUE;
    v = argValue(argc, argv, L"--restart"); if (v && v[0]) opt.restart = _wtoi(v) != 0;
    v = argValue(argc, argv, L"--wait-ms"); if (v && v[0]) opt.waitMs = (DWORD)_wtoi(v);
    v = argValue(argc, argv, L"--kill-ms"); if (v && v[0]) opt.killMs = (DWORD)_wtoi(v);
    logLine(L"[arg] 目标版本=%ls pid=%lu 重启=%d", opt.version[0] ? opt.version : L"(未知)", opt.pid, opt.restart ? 1 : 0);

    // 1) 给启动器一点时间自己优雅退出（在线更新时它是 app.exit(0)），然后再强杀
    if (opt.pid && isAlive(opt.pid)) {
        logLine(L"[kill] 先等启动器自己退出 %lu ms", opt.waitMs);
        ULONGLONG start = GetTickCount64();
        while (isAlive(opt.pid) && GetTickCount64() - start < opt.waitMs) Sleep(100);
    }

    // 2) 强杀整棵进程树，并等文件句柄真正释放
    if (killLauncher(opt.target, opt.pid, opt.killMs) != 0) {
        logLine(L"[kill] 无法拿到目标文件，放弃本次更新");
        if (g_log != INVALID_HANDLE_VALUE) CloseHandle(g_log);
        return 3;
    }

    // 3) 取新文件：已下好的直接用，否则自己下
    wchar_t newFile[MAXP] = {0};
    if (opt.staged[0] && fileExists(opt.staged)) {
        __int64 size = fileSize(opt.staged);
        BOOL good = size > 0;
        if (good && opt.size > 0 && size != opt.size) good = FALSE;
        if (good && opt.sha256[0]) {
            wchar_t actual[80] = {0};
            if (sha256OfFile(opt.staged, actual, 80)) {
                good = _wcsicmp(actual, opt.sha256) == 0;
                logLine(L"[chk] 复用已下载文件，SHA256 实际=%ls %ls", actual, good ? L"匹配" : L"不匹配");
            } else good = FALSE;
        }
        if (good) {
            wcscpy_s(newFile, MAXP, opt.staged);
            logLine(L"[chk] 复用已下载的新版文件：%ls", opt.staged);
        } else {
            logLine(L"[chk] 已下载文件不可用，改为自行下载");
        }
    }

    if (!newFile[0]) {
        if (!opt.url[0]) {
            logLine(L"[err] 既没有可用的已下载文件，也没有下载地址");
            if (g_log != INVALID_HANDLE_VALUE) CloseHandle(g_log);
            return 2;
        }
        wchar_t dest[MAXP];
        _snwprintf_s(dest, MAXP, _TRUNCATE, L"%ls\\CoA启动器.new.exe", updateDir);
        if (!fetchNewExe(&opt, dest, newFile, MAXP)) {
            logLine(L"[err] 下载/校验失败，旧启动器保持不动");
            if (g_log != INVALID_HANDLE_VALUE) CloseHandle(g_log);
            return 5;
        }
    }

    // 4) 替换
    if (!swapInto(newFile, opt.target, 10 * 60 * 1000)) {
        logLine(L"[err] 替换失败");
        if (g_log != INVALID_HANDLE_VALUE) CloseHandle(g_log);
        return 6;
    }

    // 5) 重启
    if (opt.restart) {
        Sleep(800);   // 让文件句柄彻底松开
        restartLauncher(opt.target, opt.root);
    }

    logLine(L"======== 更新完成：%ls ========", opt.version[0] ? opt.version : L"");
    if (g_log != INVALID_HANDLE_VALUE) CloseHandle(g_log);
    return 0;
}
