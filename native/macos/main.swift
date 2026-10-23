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
// El servidor sale con este código al actualizarse (UPDATE_EXIT_CODE en updates.py); el actualizador reabre la app
private let updateExitCode: Int32 = 75

private let brandHTML = #"<div class="brand"><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="2.4" rx="1.2" fill="var(--ink)"/><rect x="1" y="9.2" width="18" height="5.6" rx="2" fill="var(--logo-hl)"/><rect x="2" y="10.8" width="15" height="2.4" rx="1.2" fill="var(--accent)"/><rect x="2" y="17.6" width="11" height="2.4" rx="1.2" fill="var(--ink)"/></svg>Letha</div>"#

private let themeDefaultsKey = "theme"

private struct ThemeStyle {
    let css: String
    let windowColor: NSColor
}

// Copia de los tokens de frontend/app/globals.css: estas pantallas se muestran antes de que cargue la interfaz
private let themeStyles: [String: ThemeStyle] = [
    "light": ThemeStyle(
        css: "--base:#f1f3f6;--ink:#1a1d20;--muted:#5a6068;--accent:#2d3748;--logo-hl:rgba(45,55,72,0.14);--danger:#b42318;--dialog:linear-gradient(180deg,rgba(255,255,255,0.74) 0%,rgba(255,255,255,0.50) 100%);--ring-dialog:inset 0 0 0 1px rgba(255,255,255,0.85),inset 0 1px 0 rgba(255,255,255,0.95),0 32px 80px rgba(18,20,24,0.20);--ambient:radial-gradient(850px 700px at 4% 0%,rgba(195,205,218,0.55) 0%,rgba(195,205,218,0) 65%),radial-gradient(950px 750px at 96% 8%,rgba(165,178,192,0.35) 0%,rgba(165,178,192,0) 62%),radial-gradient(1100px 800px at 70% 60%,rgba(218,222,228,0.65) 0%,rgba(218,222,228,0) 65%),radial-gradient(950px 750px at 2% 94%,rgba(188,198,208,0.48) 0%,rgba(188,198,208,0) 62%),linear-gradient(160deg,#f7f8fa 0%,#ebeef2 100%)",
        windowColor: NSColor(red: 0xf1 / 255, green: 0xf3 / 255, blue: 0xf6 / 255, alpha: 1)
    ),
    "sepia": ThemeStyle(
        css: "--base:#efe8dc;--ink:#3a2e20;--muted:#6d5c47;--accent:#544434;--logo-hl:rgba(214,180,110,0.4);--danger:#9b2a1f;--dialog:linear-gradient(180deg,rgba(255,250,242,0.74) 0%,rgba(250,244,232,0.52) 100%);--ring-dialog:inset 0 0 0 1px rgba(255,255,255,0.80),inset 0 1px 0 rgba(255,255,255,0.90),0 32px 80px rgba(58,46,32,0.20);--ambient:radial-gradient(850px 700px at 4% 0%,rgba(214,185,150,0.55) 0%,rgba(214,185,150,0) 65%),radial-gradient(950px 750px at 96% 8%,rgba(175,155,130,0.30) 0%,rgba(175,155,130,0) 62%),radial-gradient(1100px 800px at 70% 60%,rgba(230,210,180,0.65) 0%,rgba(230,210,180,0) 65%),radial-gradient(950px 750px at 2% 94%,rgba(200,175,145,0.45) 0%,rgba(200,175,145,0) 62%),linear-gradient(160deg,#f4eee4 0%,#eae2d4 100%)",
        windowColor: NSColor(red: 0xef / 255, green: 0xe8 / 255, blue: 0xdc / 255, alpha: 1)
    ),
    "dark": ThemeStyle(
        css: "--base:#0d0e11;--ink:#e6e9ed;--muted:#939ba6;--accent:#9ab3cf;--logo-hl:rgba(154,179,207,0.22);--danger:#f0a093;--dialog:linear-gradient(180deg,rgba(28,32,38,0.75) 0%,rgba(16,18,22,0.55) 100%);--ring-dialog:inset 0 0 0 1px rgba(255,255,255,0.09),inset 0 1px 0 rgba(255,255,255,0.14),0 32px 80px rgba(0,0,0,0.55);--ambient:radial-gradient(850px 700px at 4% 0%,rgba(65,76,92,0.45) 0%,rgba(65,76,92,0) 65%),radial-gradient(950px 750px at 96% 8%,rgba(42,52,65,0.55) 0%,rgba(42,52,65,0) 62%),radial-gradient(1100px 800px at 70% 60%,rgba(35,42,54,0.45) 0%,rgba(35,42,54,0) 65%),radial-gradient(950px 750px at 2% 94%,rgba(30,38,48,0.65) 0%,rgba(30,38,48,0) 62%),linear-gradient(160deg,#101216 0%,#090a0d 100%)",
        windowColor: NSColor(red: 0x0d / 255, green: 0x0e / 255, blue: 0x11 / 255, alpha: 1)
    ),
]

private var savedThemeStyle: ThemeStyle {
    themeStyles[UserDefaults.standard.string(forKey: themeDefaultsKey) ?? ""] ?? themeStyles["light"]!
}

private let languageDefaultsKey = "uiLanguage"

private struct NativeStrings {
    let starting: String
    let about: String
    let hide: String
    let hideOthers: String
    let showAll: String
    let quit: String
    let startErrorTitle: String
    let launchFailed: String
    let serverStopped: String
}

// La interfaz envía su idioma con el mensaje lethaLanguage; estas pantallas se muestran antes de que cargue
private let nativeStrings: [String: NativeStrings] = [
    "en": NativeStrings(
        starting: "Starting Letha…",
        about: "About Letha",
        hide: "Hide Letha",
        hideOthers: "Hide Others",
        showAll: "Show All",
        quit: "Quit Letha",
        startErrorTitle: "Letha couldn’t start",
        launchFailed: "Letha couldn’t be launched:",
        serverStopped: "The Letha server stopped unexpectedly.\nCheck the log at ~/Library/Logs/letha.log."
    ),
    "es": NativeStrings(
        starting: "Iniciando Letha…",
        about: "Acerca de Letha",
        hide: "Ocultar Letha",
        hideOthers: "Ocultar otros",
        showAll: "Mostrar todo",
        quit: "Salir de Letha",
        startErrorTitle: "Error al iniciar Letha",
        launchFailed: "No se pudo arrancar Letha:",
        serverStopped: "El servidor de Letha se detuvo inesperadamente.\nRevisa el log en ~/Library/Logs/letha.log."
    ),
    "fr": NativeStrings(
        starting: "Démarrage de Letha…",
        about: "À propos de Letha",
        hide: "Masquer Letha",
        hideOthers: "Masquer les autres",
        showAll: "Tout afficher",
        quit: "Quitter Letha",
        startErrorTitle: "Letha n’a pas pu démarrer",
        launchFailed: "Impossible de lancer Letha :",
        serverStopped: "Le serveur de Letha s’est arrêté de façon inattendue.\nConsultez le journal dans ~/Library/Logs/letha.log."
    ),
    "it": NativeStrings(
        starting: "Avvio di Letha…",
        about: "Informazioni su Letha",
        hide: "Nascondi Letha",
        hideOthers: "Nascondi altre",
        showAll: "Mostra tutte",
        quit: "Esci da Letha",
        startErrorTitle: "Impossibile avviare Letha",
        launchFailed: "Non è stato possibile avviare Letha:",
        serverStopped: "Il server di Letha si è arrestato in modo imprevisto.\nControlla il log in ~/Library/Logs/letha.log."
    ),
    "pt": NativeStrings(
        starting: "Iniciando o Letha…",
        about: "Sobre o Letha",
        hide: "Ocultar Letha",
        hideOthers: "Ocultar Outros",
        showAll: "Mostrar Tudo",
        quit: "Encerrar Letha",
        startErrorTitle: "Não foi possível iniciar o Letha",
        launchFailed: "Não foi possível abrir o Letha:",
        serverStopped: "O servidor do Letha parou inesperadamente.\nVeja o log em ~/Library/Logs/letha.log."
    ),
]

private var savedLanguage: String {
    let language = UserDefaults.standard.string(forKey: languageDefaultsKey) ?? ""
    return nativeStrings[language] != nil ? language : "en"
}

private var strings: NativeStrings { nativeStrings[savedLanguage]! }

func loadingPageHTML(_ content: String) -> String {
    """
    <!doctype html><html lang="\(savedLanguage)"><head><meta charset="utf-8"><style>
    :root{\(savedThemeStyle.css)}
    body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background-color:var(--base);background-image:var(--ambient);color:var(--ink);font-family:-apple-system,system-ui;-webkit-font-smoothing:antialiased}
    .brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600;letter-spacing:-0.01em}
    .brand svg{width:24px;height:24px}
    .spinner{width:28px;height:28px;fill:none;stroke:var(--accent);stroke-width:2;stroke-linecap:round;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .muted{font-size:14px;line-height:1.6;color:var(--muted)}
    .card{max-width:440px;margin:0 24px;padding:28px;border-radius:30px;background:var(--dialog);box-shadow:var(--ring-dialog)}
    .card h2{margin:0 0 8px;font-family:ui-serif,"New York",Georgia,serif;font-size:24px;font-weight:400;color:var(--danger)}
    </style></head><body>\(content)</body></html>
    """
}

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
            showStatus(strings.starting)
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
        window.backgroundColor = savedThemeStyle.windowColor
        window.minSize = NSSize(width: 800, height: 550)
        window.center()
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.userContentController.add(self, name: "lethaTheme")
        config.userContentController.add(self, name: "lethaLanguage")
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
            withTitle: strings.about,
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: strings.hide,
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthers = NSMenuItem(
            title: strings.hideOthers,
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(
            withTitle: strings.showAll,
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: strings.quit,
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
            showError("\(strings.launchFailed)\n\n\(error.localizedDescription)")
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
        if p.terminationStatus == updateExitCode {
            NSApp.terminate(nil)
            return
        }
        log("El servidor terminó inesperadamente (código \(p.terminationStatus))")
        showError(strings.serverStopped)
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
          <h2>\(strings.startErrorTitle)</h2>
          <div class="muted">\(escaped)</div>
        </div>
        """)
    }

    private func showPage(_ content: String) {
        webView.loadHTMLString(loadingPageHTML(content), baseURL: nil)
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

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let value = message.body as? String else { return }
        if message.name == "lethaTheme", themeStyles[value] != nil {
            UserDefaults.standard.set(value, forKey: themeDefaultsKey)
        } else if message.name == "lethaLanguage", nativeStrings[value] != nil, value != savedLanguage {
            UserDefaults.standard.set(value, forKey: languageDefaultsKey)
            buildMenu()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
