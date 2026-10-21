// letha — ventana nativa de macOS.
//
// Es a la vez lanzador y ventana: arranca el servidor de letha (el comando
// que instala uv), muestra la interfaz en un WKWebView y detiene el servidor
// al cerrarse. Da a letha su propio icono en el Dock y en Cmd+Tab, en vez
// de ser una ventana más del navegador.

import Cocoa
import UniformTypeIdentifiers
import WebKit

private let readyPrefix = "LETHA_APP_READY "

private let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/letha.log")

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var ownsServer = false
    private var baseURL: URL?
    private var stdoutBuffer = Data()
    private var terminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()

        if let arg = CommandLine.arguments.dropFirst().first(where: { $0.hasPrefix("http") }),
           let url = URL(string: arg) {
            open(url)
        } else {
            showStatus("Iniciando Letha...")
            startServer()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminating = true
        guard ownsServer, let server, server.isRunning else { return }

        server.terminate()
        for _ in 0..<10 {
            if !server.isRunning { return }
            Thread.sleep(forTimeInterval: 0.1)
        }
        kill(server.processIdentifier, SIGKILL)
    }

    private func buildWindow() {
        let mask: NSWindow.StyleMask = [
            .titled,
            .closable,
            .miniaturizable,
            .resizable,
            .fullSizeContentView,
        ]
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 750),
            styleMask: mask,
            backing: .buffered,
            defer: false
        )
        window.title = "Letha"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 800, height: 550)
        window.center()
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        window.contentView!.addSubview(webView)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)

        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "Acerca de Letha",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: "Ocultar Letha",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthers = NSMenuItem(
            title: "Ocultar otros",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(
            withTitle: "Mostrar todo",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: "Salir de Letha",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        NSApp.mainMenu = menu
    }

    private func startServer() {
        let command = resolveCommand()
        log("Arrancando servidor: \(command)")

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/sh")
        proc.arguments = ["-c", "exec \"$@\"", "--", command]

        var env = ProcessInfo.processInfo.environment
        env["LETHA_NATIVE"] = "1"
        proc.environment = env

        let stdoutPipe = Pipe()
        proc.standardOutput = stdoutPipe
        proc.standardError = stdoutPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else { return }
            DispatchQueue.main.async { self?.consumeStdout(chunk) }
        }

        proc.terminationHandler = { [weak self] p in
            DispatchQueue.main.async { self?.serverDidExit(p) }
        }

        do {
            try proc.run()
            server = proc
            ownsServer = true
        } catch {
            showError("No se pudo arrancar Letha:\n\n\(error.localizedDescription)")
        }
    }

    private func consumeStdout(_ chunk: Data) {
        logChunk(chunk)
        stdoutBuffer.append(chunk)

        while let newlineIndex = stdoutBuffer.firstIndex(of: 0x0A) {
            let lineData = stdoutBuffer.prefix(upTo: newlineIndex)
            stdoutBuffer.removeSubrange(..<(newlineIndex + 1))
            guard let line = String(data: lineData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
            if line.hasPrefix(readyPrefix) {
                let rest = line.dropFirst(readyPrefix.count)
                if let url = URL(string: String(rest)) {
                    open(url)
                    return
                }
            }
        }
    }

    private func serverDidExit(_ p: Process) {
        if terminating { return }
        log("El servidor terminó inesperadamente (código \(p.terminationStatus))")
        showError("El servidor de Letha se detuvo inesperadamente.\nRevisa el log en ~/Library/Logs/letha.log.")
    }

    private func open(_ url: URL) {
        baseURL = url
        log("Cargando interfaz en \(url)")
        webView.load(URLRequest(url: url))
    }

    private func showStatus(_ text: String) {
        let html = """
        <!doctype html><html><body style="margin:0;background:#18181b;color:#a1a1aa;font-family:-apple-system,system-ui;display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:bold;color:#f59e0b;margin-bottom:8px;">Letha</div>
          <div style="font-size:13px;">\(text)</div>
        </div>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func showError(_ message: String) {
        let escaped = message.replacingOccurrences(of: "\n", with: "<br>")
        let html = """
        <!doctype html><html><body style="margin:0;background:#18181b;color:#f87171;font-family:-apple-system,system-ui;padding:40px;">
        <div style="max-width:500px;margin:auto;border:1px solid #7f1d1d;background:#450a0a;border-radius:16px;padding:24px;">
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#fca5a5;">Error al iniciar Letha</h2>
          <div style="font-size:13px;line-height:1.6;color:#fecaca;">\(escaped)</div>
        </div>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func resolveCommand() -> String {
        if let custom = Bundle.main.object(forInfoDictionaryKey: "LethaCommand") as? String, !custom.isEmpty {
            return custom
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.local/bin/letha"
    }

    private func log(_ line: String) {
        let msg = "[\(ISO8601DateFormatter().string(from: Date()))] \(line)\n"
        guard let data = msg.data(using: .utf8) else { return }
        appendLog(data)
    }

    private func logChunk(_ data: Data) {
        appendLog(data)
    }

    private func appendLog(_ data: Data) {
        try? FileManager.default.createDirectory(
            at: logURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if let handle = try? FileHandle(forWritingTo: logURL) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: logURL)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
