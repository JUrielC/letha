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

private let brandHTML = #"<div class="brand"><div class="logo"><svg viewBox="0 0 24 24"><path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/></svg></div>Letha</div>"#

private let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/letha.log")

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var backgroundObservation: NSKeyValueObservation?
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
        // Sin .fullSizeContentView: el WKWebView se traga los clics, y la barra debe quedar fuera para poder arrastrar la ventana.
        let mask: NSWindow.StyleMask = [
            .titled,
            .closable,
            .miniaturizable,
            .resizable,
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
        window.backgroundColor = NSColor(red: 0x0a / 255, green: 0x17 / 255, blue: 0x29 / 255, alpha: 1)
        window.minSize = NSSize(width: 800, height: 550)
        window.center()
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        window.contentView!.addSubview(webView)

        backgroundObservation = webView.observe(\.underPageBackgroundColor, options: [.new]) { [weak self] webView, _ in
            self?.window.backgroundColor = webView.underPageBackgroundColor
        }

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
                let parts = line.dropFirst(readyPrefix.count).split(separator: " ")
                if let urlPart = parts.first, let url = URL(string: String(urlPart)) {
                    if parts.contains("owner=existing") {
                        ownsServer = false
                    }
                    open(url)
                    return
                }
            }
        }
    }

    private func serverDidExit(_ p: Process) {
        if terminating || !ownsServer { return }
        log("El servidor terminó inesperadamente (código \(p.terminationStatus))")
        showError("El servidor de Letha se detuvo inesperadamente.\nRevisa el log en ~/Library/Logs/letha.log.")
    }

    private func open(_ url: URL) {
        baseURL = url
        log("Cargando interfaz en \(url)")
        webView.load(URLRequest(url: url))
    }

    private func showStatus(_ text: String) {
        showPage("""
        \(brandHTML)
        <svg class="spinner" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        <div class="muted">\(text)</div>
        """)
    }

    private func showError(_ message: String) {
        let escaped = message.replacingOccurrences(of: "\n", with: "<br>")
        showPage("""
        \(brandHTML)
        <div class="card">
          <h2>Error al iniciar Letha</h2>
          <div class="muted">\(escaped)</div>
        </div>
        """)
    }

    private func showPage(_ content: String) {
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:#0a1729;color:#eaf1fa;font-family:-apple-system,system-ui;-webkit-font-smoothing:antialiased}
        svg{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;letter-spacing:-0.025em}
        .logo{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#0a1729;background:linear-gradient(135deg,#1ea7e8 0%,#64c7f5 100%)}
        .logo svg{width:20px;height:20px}
        .spinner{width:32px;height:32px;color:#1ea7e8;animation:spin 1s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .muted{font-size:14px;line-height:1.6;color:#93a3b8}
        .card{max-width:500px;margin:0 24px;padding:24px;border-radius:16px;background:#0e1d33;border:1px solid rgba(248,113,113,0.35)}
        .card h2{margin:0 0 12px;font-size:18px;color:#f87171}
        </style></head><body>\(content)</body></html>
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

extension AppDelegate: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        // WKOpenPanelParameters no expone el atributo accept; la app solo importa PDFs.
        panel.allowedContentTypes = [.pdf]
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
