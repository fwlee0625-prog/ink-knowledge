import AppKit
import CoreGraphics
import CoreText
import Darwin
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

enum CaptureAction: String {
    case save
    case copy
    case ocr
    case cancel
}

enum CaptureTool: String {
    case rect
    case ellipse
    case arrow
    case pen
    case text
}

enum MarkKind {
    case rect
    case ellipse
    case arrow
    case pen
    case text
}

struct CaptureMark {
    let kind: MarkKind
    var start: CGPoint
    var end: CGPoint
    var points: [CGPoint]
    var text: String
    var color: NSColor
    var lineWidth: CGFloat
}

private enum ToolbarHit {
    case tool(CaptureTool)
    case undo
    case action(CaptureAction)
    case confirm
}

private enum ToolbarItem {
    case tool(CaptureTool)
    case undo
    case action(CaptureAction)
    case confirm
}

private enum SelectionHandle: CaseIterable {
    case topLeft
    case top
    case topRight
    case right
    case bottomRight
    case bottom
    case bottomLeft
    case left
}

struct CaptureArguments {
    let outputDir: URL
    let defaultAction: CaptureAction?
    let validateOnly: Bool
    let selfTestRenderOnly: Bool
    let serviceMode: Bool

    static func parse() throws -> CaptureArguments {
        var outputDir: URL?
        var defaultAction: CaptureAction?
        var validateOnly = false
        var selfTestRenderOnly = false
        var serviceMode = false
        var index = 1
        let args = CommandLine.arguments

        while index < args.count {
            switch args[index] {
            case "--help", "-h":
                print("""
                moshi-capture-helper --output-dir DIR [--default-action save|copy|ocr]
                moshi-capture-helper --service

                Options:
                  --output-dir DIR          PNG 输出目录
                  --default-action ACTION   双击选区默认动作
                  --service                 常驻服务模式，从 stdin 读取 JSONL 请求
                  --validate-args           只校验参数并输出 JSON，不启动截图浮层
                  --self-test-render        生成一张标注合成测试 PNG，不启动截图浮层
                """)
                exit(0)
            case "--service":
                serviceMode = true
            case "--validate-args":
                validateOnly = true
            case "--self-test-render":
                selfTestRenderOnly = true
            case "--output-dir":
                index += 1
                guard index < args.count else {
                    throw CaptureError.message("--output-dir 缺少路径。")
                }
                outputDir = URL(fileURLWithPath: args[index], isDirectory: true)
            case "--default-action":
                index += 1
                guard index < args.count else {
                    throw CaptureError.message("--default-action 缺少动作。")
                }
                guard let action = CaptureAction(rawValue: args[index]) else {
                    throw CaptureError.message("不支持的默认动作: \(args[index])。")
                }
                guard action != .cancel else {
                    throw CaptureError.message("--default-action 不支持 cancel。")
                }
                defaultAction = action
            default:
                break
            }
            index += 1
        }

        let fallback = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("moshi-captures", isDirectory: true)
        return CaptureArguments(
            outputDir: outputDir ?? fallback,
            defaultAction: defaultAction,
            validateOnly: validateOnly,
            selfTestRenderOnly: selfTestRenderOnly,
            serviceMode: serviceMode
        )
    }
}

final class JSONLineWriter {
    private let lock = NSLock()

    func write(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              var text = String(data: data, encoding: .utf8) else {
            return
        }
        text.append("\n")
        guard let output = text.data(using: .utf8) else {
            return
        }
        lock.lock()
        FileHandle.standardOutput.write(output)
        lock.unlock()
    }
}

enum CaptureError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let value):
            return value
        }
    }
}

protocol CaptureEngine {
    func capture(selection: CGRect, on screen: NSScreen, completion: @escaping (Result<CGImage, Error>) -> Void)
}

final class ScreenCaptureKitCaptureEngine: CaptureEngine {
    func capture(selection: CGRect, on screen: NSScreen, completion: @escaping (Result<CGImage, Error>) -> Void) {
        guard #available(macOS 14.0, *) else {
            completion(.failure(CaptureError.message("原生截图需要 macOS 14.0 或更高版本。")))
            return
        }

        guard let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else {
            completion(.failure(CaptureError.message("无法读取屏幕编号。")))
            return
        }

        currentShareableContent { contentResult in
            switch contentResult {
            case .success(let content):
                guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                    completion(.failure(CaptureError.message("无法匹配 ScreenCaptureKit 屏幕。")))
                    return
                }

                if #available(macOS 15.2, *) {
                    let rect = self.displaySpaceRect(selection, in: display)
                    guard rect.width > 0, rect.height > 0 else {
                        completion(.failure(CaptureError.message("截图区域太小。")))
                        return
                    }
                    self.captureDisplaySpaceRect(rect, completion: completion)
                    return
                }

                self.captureWithFilter(selection: selection, on: screen, display: display, completion: completion)

            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    @available(macOS 15.2, *)
    private func captureDisplaySpaceRect(_ rect: CGRect, completion: @escaping (Result<CGImage, Error>) -> Void) {
        SCScreenshotManager.captureImage(in: rect) { image, error in
            if let image {
                completion(.success(image))
            } else {
                completion(.failure(error ?? CaptureError.message("ScreenCaptureKit 没有返回截图。")))
            }
        }
    }

    @available(macOS 14.0, *)
    private func captureWithFilter(
        selection: CGRect,
        on screen: NSScreen,
        display: SCDisplay,
        completion: @escaping (Result<CGImage, Error>) -> Void
    ) {
        let rect = displayLocalRect(selection, in: display)
        guard rect.width > 0, rect.height > 0 else {
            completion(.failure(CaptureError.message("截图区域太小。")))
            return
        }

        let scale = screen.backingScaleFactor
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = rect
        configuration.width = Int(rect.width * scale)
        configuration.height = Int(rect.height * scale)
        configuration.showsCursor = false

        let filter = SCContentFilter(display: display, excludingWindows: [])
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
            if let image {
                completion(.success(image))
            } else {
                completion(.failure(error ?? CaptureError.message("ScreenCaptureKit 没有返回截图。")))
            }
        }
    }

    @available(macOS 14.0, *)
    private func currentShareableContent(completion: @escaping (Result<SCShareableContent, Error>) -> Void) {
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
            if let content {
                completion(.success(content))
            } else {
                completion(.failure(error ?? CaptureError.message("读取可截图屏幕失败。")))
            }
        }
    }

    @available(macOS 14.0, *)
    private func displaySpaceRect(_ selection: CGRect, in display: SCDisplay) -> CGRect {
        let rect = clamp(selection, width: CGFloat(display.width), height: CGFloat(display.height))
        return CGRect(
            x: display.frame.minX + rect.minX,
            y: display.frame.minY + rect.minY,
            width: rect.width,
            height: rect.height
        ).integral
    }

    @available(macOS 14.0, *)
    private func displayLocalRect(_ selection: CGRect, in display: SCDisplay) -> CGRect {
        clamp(selection, width: CGFloat(display.width), height: CGFloat(display.height)).integral
    }

    private func clamp(_ rect: CGRect, width: CGFloat, height: CGFloat) -> CGRect {
        let minX = min(max(0, rect.minX), width)
        let minY = min(max(0, rect.minY), height)
        let maxX = min(max(minX, rect.maxX), width)
        let maxY = min(max(minY, rect.maxY), height)
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

final class CaptureCoordinator: NSObject {
    typealias Completion = (_ payload: [String: Any], _ isError: Bool) -> Void

    private let args: CaptureArguments
    private let engine: CaptureEngine
    private let terminateOnFinish: Bool
    private let completion: Completion
    private var windows: [CaptureWindow] = []
    private var didFinish = false
    private let writer = JSONLineWriter()

    init(
        args: CaptureArguments,
        engine: CaptureEngine = ScreenCaptureKitCaptureEngine(),
        terminateOnFinish: Bool = true,
        completion: Completion? = nil
    ) {
        self.args = args
        self.engine = engine
        self.terminateOnFinish = terminateOnFinish
        self.completion = completion ?? { payload, _ in
            JSONLineWriter().write(payload)
        }
        super.init()
    }

    func start() {
        guard ensureScreenCapturePermission() else {
            finishError("截图失败，请在系统设置的隐私与安全性中允许墨识进行屏幕录制。")
            return
        }

        NSApp.setActivationPolicy(.accessory)
        NSApp.activate(ignoringOtherApps: true)

        let screens = NSScreen.screens
        guard !screens.isEmpty else {
            finishError("未找到可用屏幕。")
            return
        }

        windows = screens.map { screen in
            let window = CaptureWindow(screen: screen)
            let view = CaptureOverlayView(frame: NSRect(origin: .zero, size: screen.frame.size))
            view.coordinator = self
            view.screen = screen
            view.captureWindow = window
            view.defaultAction = args.defaultAction
            window.contentView = view
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(view)
            return window
        }
    }

    private func ensureScreenCapturePermission() -> Bool {
        if CGPreflightScreenCaptureAccess() {
            return true
        }
        return CGRequestScreenCaptureAccess()
    }

    func runSelfTestRender() {
        do {
            let selection = CGRect(x: 0, y: 0, width: 320, height: 180)
            let baseImage = try makeSelfTestBaseImage(size: selection.size)
            let marks = makeSelfTestMarks()
            let finalImage = try renderFinalImage(baseImage: baseImage, marks: marks, selection: selection)
            let imagePath = try writePNG(image: finalImage)
            writeJSON([
                "action": "self-test",
                "imagePath": imagePath.path,
                "fileName": imagePath.lastPathComponent,
                "rect": [
                    "x": selection.minX,
                    "y": selection.minY,
                    "width": selection.width,
                    "height": selection.height,
                ],
            ])
        } catch {
            finishError(humanReadableCaptureError(error))
        }
    }

    func finish(action: CaptureAction, selection: CGRect?, screen: NSScreen?, marks: [CaptureMark]) {
        guard !didFinish else { return }
        didFinish = true

        guard action != .cancel else {
            finishPayload(["action": CaptureAction.cancel.rawValue])
            return
        }

        guard let selection, let screen else {
            finishError("请先框选截图区域。")
            return
        }

        windows.forEach { $0.orderOut(nil) }
        usleep(120_000)

        engine.capture(selection: selection, on: screen) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let image):
                    self.finishCapture(
                        action: action,
                        image: image,
                        selection: selection,
                        marks: marks
                    )
                case .failure(let error):
                    self.finishError(self.humanReadableCaptureError(error))
                }
            }
        }
    }

    private func finishCapture(action: CaptureAction, image: CGImage, selection: CGRect, marks: [CaptureMark]) {
        do {
            let finalImage = try renderFinalImage(baseImage: image, marks: marks, selection: selection)
            let imagePath = try writePNG(image: finalImage)

            if action == .copy {
                copyPNGToPasteboard(image: finalImage)
            }

            finishPayload([
                "action": action.rawValue,
                "imagePath": imagePath.path,
                "fileName": imagePath.lastPathComponent,
                "rect": [
                    "x": selection.minX,
                    "y": selection.minY,
                    "width": selection.width,
                    "height": selection.height,
                ],
            ])
        } catch {
            finishError(humanReadableCaptureError(error))
        }
    }

    private func humanReadableCaptureError(_ error: Error) -> String {
        let message = String(describing: error)
        if message.localizedCaseInsensitiveContains("permission")
            || message.localizedCaseInsensitiveContains("denied")
            || message.localizedCaseInsensitiveContains("TCC")
            || message.localizedCaseInsensitiveContains("not authorized") {
            return "截图失败，请在系统设置的隐私与安全性中允许墨识进行屏幕录制。"
        }
        return message
    }

    private func makeSelfTestBaseImage(size: CGSize) throws -> CGImage {
        guard let context = CGContext(
            data: nil,
            width: Int(size.width),
            height: Int(size.height),
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw CaptureError.message("创建自检底图画布失败。")
        }

        context.setFillColor(CGColor(red: 0.96, green: 0.96, blue: 0.96, alpha: 1))
        context.fill(CGRect(origin: .zero, size: size))
        context.setStrokeColor(CGColor(red: 0.86, green: 0.9, blue: 0.95, alpha: 1))
        context.setLineWidth(1)
        for x in stride(from: CGFloat(20), through: size.width, by: 20) {
            context.move(to: CGPoint(x: x, y: 0))
            context.addLine(to: CGPoint(x: x, y: size.height))
        }
        for y in stride(from: CGFloat(20), through: size.height, by: 20) {
            context.move(to: CGPoint(x: 0, y: y))
            context.addLine(to: CGPoint(x: size.width, y: y))
        }
        context.strokePath()

        drawText(
            "Moshi Capture Self Test",
            at: CGPoint(x: 18, y: 18),
            in: context,
            color: NSColor(calibratedWhite: 0.18, alpha: 1),
            scale: 0.82,
            canvasHeight: size.height
        )

        guard let cgImage = context.makeImage() else {
            throw CaptureError.message("生成自检底图失败。")
        }
        return cgImage
    }

    private func makeSelfTestMarks() -> [CaptureMark] {
        [
            CaptureMark(
                kind: .rect,
                start: CGPoint(x: 22, y: 54),
                end: CGPoint(x: 132, y: 126),
                points: [],
                text: "",
                color: .systemRed,
                lineWidth: 3
            ),
            CaptureMark(
                kind: .ellipse,
                start: CGPoint(x: 156, y: 52),
                end: CGPoint(x: 244, y: 124),
                points: [],
                text: "",
                color: .systemBlue,
                lineWidth: 3
            ),
            CaptureMark(
                kind: .arrow,
                start: CGPoint(x: 36, y: 150),
                end: CGPoint(x: 284, y: 72),
                points: [],
                text: "",
                color: .systemGreen,
                lineWidth: 4
            ),
            CaptureMark(
                kind: .pen,
                start: .zero,
                end: .zero,
                points: [
                    CGPoint(x: 168, y: 145),
                    CGPoint(x: 190, y: 132),
                    CGPoint(x: 212, y: 150),
                    CGPoint(x: 236, y: 136),
                    CGPoint(x: 260, y: 152),
                ],
                text: "",
                color: .systemOrange,
                lineWidth: 4
            ),
            CaptureMark(
                kind: .text,
                start: CGPoint(x: 198, y: 28),
                end: CGPoint(x: 198, y: 28),
                points: [],
                text: "OCR",
                color: .systemPurple,
                lineWidth: 3
            ),
        ]
    }

    private func renderFinalImage(baseImage: CGImage, marks: [CaptureMark], selection: CGRect) throws -> CGImage {
        guard !marks.isEmpty else { return baseImage }

        let scaleX = CGFloat(baseImage.width) / max(selection.width, 1)
        let scaleY = CGFloat(baseImage.height) / max(selection.height, 1)
        let width = baseImage.width
        let height = baseImage.height
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw CaptureError.message("创建标注合成画布失败。")
        }

        let canvas = CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
        context.interpolationQuality = .high
        context.draw(baseImage, in: canvas)
        for mark in marks {
            drawMark(mark, in: context, scaleX: scaleX, scaleY: scaleY, canvasHeight: CGFloat(height))
        }

        guard let cgImage = context.makeImage() else {
            throw CaptureError.message("合成标注截图失败。")
        }
        return cgImage
    }

    private func drawMark(_ mark: CaptureMark, in context: CGContext, scaleX: CGFloat, scaleY: CGFloat, canvasHeight: CGFloat) {
        context.saveGState()
        context.setStrokeColor(cgColor(mark.color))
        context.setFillColor(cgColor(mark.color))
        let lineWidth = max(1, mark.lineWidth * ((scaleX + scaleY) / 2))
        context.setLineWidth(lineWidth)
        context.setLineCap(.round)
        context.setLineJoin(.round)

        switch mark.kind {
        case .rect:
            context.stroke(flipRect(scaleRect(normalizedRect(from: mark.start, to: mark.end), scaleX: scaleX, scaleY: scaleY), canvasHeight: canvasHeight))
        case .ellipse:
            context.strokeEllipse(in: flipRect(scaleRect(normalizedRect(from: mark.start, to: mark.end), scaleX: scaleX, scaleY: scaleY), canvasHeight: canvasHeight))
        case .arrow:
            let start = flipPoint(scalePoint(mark.start, scaleX: scaleX, scaleY: scaleY), canvasHeight: canvasHeight)
            let end = flipPoint(scalePoint(mark.end, scaleX: scaleX, scaleY: scaleY), canvasHeight: canvasHeight)
            context.move(to: start)
            context.addLine(to: end)
            context.strokePath()
            drawArrowHead(start: start, end: end, in: context, lineWidth: lineWidth)
        case .pen:
            if let first = mark.points.first {
                context.move(to: flipPoint(scalePoint(first, scaleX: scaleX, scaleY: scaleY), canvasHeight: canvasHeight))
                for point in mark.points.dropFirst() {
                    context.addLine(to: flipPoint(scalePoint(point, scaleX: scaleX, scaleY: scaleY), canvasHeight: canvasHeight))
                }
                context.strokePath()
            }
        case .text:
            let point = scalePoint(mark.start, scaleX: scaleX, scaleY: scaleY)
            drawText(mark.text, at: point, in: context, color: mark.color, scale: (scaleX + scaleY) / 2, canvasHeight: canvasHeight)
        }
        context.restoreGState()
    }

    private func drawArrowHead(start: CGPoint, end: CGPoint, in context: CGContext, lineWidth: CGFloat) {
        let angle = atan2(end.y - start.y, end.x - start.x)
        let length = max(14, lineWidth * 4)
        let left = CGPoint(
            x: end.x - length * cos(angle - .pi / 6),
            y: end.y - length * sin(angle - .pi / 6)
        )
        let right = CGPoint(
            x: end.x - length * cos(angle + .pi / 6),
            y: end.y - length * sin(angle + .pi / 6)
        )
        context.beginPath()
        context.move(to: end)
        context.addLine(to: left)
        context.addLine(to: right)
        context.closePath()
        context.fillPath()
    }

    private func drawText(_ text: String, at point: CGPoint, in context: CGContext, color: NSColor, scale: CGFloat, canvasHeight: CGFloat) {
        let fontSize = 22 * scale
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: fontSize, weight: .bold),
            .foregroundColor: color,
        ]
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let line = CTLineCreateWithAttributedString(attributed)

        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: 0, y: canvasHeight)
        context.scaleBy(x: 1, y: -1)
        context.textPosition = CGPoint(x: point.x, y: point.y + fontSize)
        CTLineDraw(line, context)
        context.restoreGState()
    }

    private func scalePoint(_ point: CGPoint, scaleX: CGFloat, scaleY: CGFloat) -> CGPoint {
        CGPoint(x: point.x * scaleX, y: point.y * scaleY)
    }

    private func scaleRect(_ rect: CGRect, scaleX: CGFloat, scaleY: CGFloat) -> CGRect {
        CGRect(
            x: rect.minX * scaleX,
            y: rect.minY * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY
        )
    }

    private func flipPoint(_ point: CGPoint, canvasHeight: CGFloat) -> CGPoint {
        CGPoint(x: point.x, y: canvasHeight - point.y)
    }

    private func flipRect(_ rect: CGRect, canvasHeight: CGFloat) -> CGRect {
        CGRect(x: rect.minX, y: canvasHeight - rect.maxY, width: rect.width, height: rect.height)
    }

    private func cgColor(_ color: NSColor) -> CGColor {
        color.usingColorSpace(.deviceRGB)?.cgColor ?? NSColor.systemRed.cgColor
    }

    private func normalizedRect(from start: CGPoint, to end: CGPoint) -> CGRect {
        CGRect(
            x: min(start.x, end.x),
            y: min(start.y, end.y),
            width: abs(end.x - start.x),
            height: abs(end.y - start.y)
        )
    }

    private func writePNG(image: CGImage) throws -> URL {
        try FileManager.default.createDirectory(at: args.outputDir, withIntermediateDirectories: true)
        let path = args.outputDir.appendingPathComponent("capture-\(timestampMillis()).png")
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw CaptureError.message("生成 PNG 失败。")
        }
        try data.write(to: path, options: .atomic)
        return path
    }

    private func copyPNGToPasteboard(image: CGImage) {
        let nsImage = NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([nsImage])
    }

    private func timestampMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func finishError(_ message: String) {
        finishPayload([
            "action": "error",
            "message": message,
        ], isError: true)
        fputs("moshi-capture-helper: \(message)\n", stderr)
    }

    private func finishPayload(_ payload: [String: Any], isError: Bool = false) {
        closeWindows()
        completion(payload, isError)
        if terminateOnFinish {
            if isError {
                exit(1)
            }
            NSApp.terminate(nil)
        }
    }

    private func writeJSON(_ payload: [String: Any]) {
        writer.write(payload)
    }

    private func closeWindows() {
        windows.forEach { window in
            window.orderOut(nil)
            window.close()
        }
        windows.removeAll()
    }
}

final class CaptureWindow: NSPanel {
    init(screen: NSScreen) {
        super.init(
            contentRect: screen.frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        self.level = .screenSaver
        self.backgroundColor = .clear
        self.isOpaque = false
        self.hasShadow = false
        self.hidesOnDeactivate = false
        self.ignoresMouseEvents = false
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .transient]
        self.acceptsMouseMovedEvents = true
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            (contentView as? CaptureOverlayView)?.cancelFromKeyboard()
            return
        }
        super.keyDown(with: event)
    }

    override func cancelOperation(_ sender: Any?) {
        (contentView as? CaptureOverlayView)?.cancelFromKeyboard()
    }
}

final class CaptureOverlayView: NSView {
    weak var coordinator: CaptureCoordinator?
    weak var screen: NSScreen?
    weak var captureWindow: NSWindow?
    var defaultAction: CaptureAction?

    private var dragStart: CGPoint?
    private var selection: CGRect?
    private var isSelecting = false
    private var selectedTool: CaptureTool?
    private var isMovingSelection = false
    private var isResizingSelection = false
    private var activeHandle: SelectionHandle?
    private var interactionStart: CGPoint?
    private var originalSelection: CGRect?
    private var marks: [CaptureMark] = []
    private var draftMark: CaptureMark?
    private var isDrawingMark = false
    private var textField: NSTextField?
    private var textFieldLocalPoint: CGPoint?
    private var trackingArea: NSTrackingArea?
    private let markColor = NSColor.systemRed
    private let markLineWidth: CGFloat = 3
    private let minimumSelectionSize: CGFloat = 8
    private let toolbarItems: [ToolbarItem] = [
        .tool(.rect),
        .tool(.ellipse),
        .tool(.arrow),
        .tool(.pen),
        .tool(.text),
        .undo,
        .action(.ocr),
        .action(.copy),
        .action(.save),
        .action(.cancel),
        .confirm,
    ]

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let nextArea = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .inVisibleRect, .mouseMoved, .mouseEnteredAndExited],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(nextArea)
        trackingArea = nextArea
    }

    func cancelFromKeyboard() {
        if textField != nil {
            cancelInlineText()
            return
        }
        coordinator?.finish(action: .cancel, selection: nil, screen: nil, marks: [])
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            cancelFromKeyboard()
        } else if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers?.lowercased() == "z" {
            undoMark()
        } else {
            super.keyDown(with: event)
        }
    }

    override func mouseMoved(with event: NSEvent) {
        updateCursor(at: convert(event.locationInWindow, from: nil))
    }

    override func mouseExited(with event: NSEvent) {
        NSCursor.arrow.set()
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let hit = toolbarAction(at: point) {
            handleToolbarHit(hit)
            return
        }

        if let selection, selection.width >= minimumSelectionSize, selection.height >= minimumSelectionSize {
            if selection.contains(point), event.clickCount >= 2, let defaultAction {
                coordinator?.finish(action: defaultAction, selection: selection, screen: screen, marks: marks)
                return
            }
            if let handle = selectionHandle(at: point, in: selection) {
                startResize(handle: handle, at: point)
            } else if selection.contains(point), selectedTool != nil {
                startMark(at: point)
            } else if selection.contains(point) {
                startMoveSelection(at: point)
            } else {
                startNewSelection(at: point)
            }
        } else {
            startNewSelection(at: point)
        }
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let dragStart else { return }
        let point = clamped(convert(event.locationInWindow, from: nil))
        if isDrawingMark {
            updateDraftMark(at: point)
            updateCursor(at: point)
            needsDisplay = true
            return
        }
        if isMovingSelection {
            updateMovedSelection(to: point)
            NSCursor.closedHand.set()
            needsDisplay = true
            return
        }
        if isResizingSelection {
            updateResizedSelection(to: point)
            cursor(for: point).set()
            needsDisplay = true
            return
        }
        selection = normalizedRect(from: dragStart, to: point)
        NSCursor.crosshair.set()
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        if isDrawingMark {
            commitDraftMark()
            return
        }
        if isMovingSelection || isResizingSelection {
            endSelectionTransform()
            return
        }
        isSelecting = false
        guard let current = selection else { return }
        if current.width < minimumSelectionSize || current.height < minimumSelectionSize {
            selection = nil
        }
        updateCursor(at: convert(event.locationInWindow, from: nil))
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawShade()
        guard let selection else {
            drawHint()
            return
        }
        drawSelection(selection)
        drawMarks()
        if !isSelecting && selection.width >= minimumSelectionSize && selection.height >= minimumSelectionSize {
            drawToolbar(for: selection)
        }
    }

    private func drawShade() {
        let path = NSBezierPath(rect: bounds)
        if let selection {
            path.append(NSBezierPath(rect: selection))
            path.windingRule = .evenOdd
        }
        NSColor.black.withAlphaComponent(0.34).setFill()
        path.fill()
    }

    private func drawHint() {
        let text = "拖拽选择截屏区域，Esc 取消"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 15, weight: .medium),
            .foregroundColor: NSColor.white.withAlphaComponent(0.92),
        ]
        let size = text.size(withAttributes: attributes)
        let rect = CGRect(
            x: (bounds.width - size.width) / 2,
            y: max(80, bounds.height * 0.18),
            width: size.width,
            height: size.height
        )
        text.draw(in: rect, withAttributes: attributes)
    }

    private func drawSelection(_ rect: CGRect) {
        NSColor.systemBlue.setStroke()
        let border = NSBezierPath(rect: rect)
        border.lineWidth = 3
        border.stroke()
        if !isSelecting {
            drawSelectionHandles(for: rect)
        }

        let label = "\(Int(rect.width)) x \(Int(rect.height))"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: NSColor.white,
        ]
        let labelSize = label.size(withAttributes: attributes)
        let labelRect = CGRect(
            x: rect.minX,
            y: max(8, rect.minY - labelSize.height - 8),
            width: labelSize.width + 14,
            height: labelSize.height + 8
        )
        NSColor.black.withAlphaComponent(0.72).setFill()
        NSBezierPath(roundedRect: labelRect, xRadius: 5, yRadius: 5).fill()
        label.draw(
            in: labelRect.insetBy(dx: 7, dy: 4),
            withAttributes: attributes
        )
    }

    private func drawMarks() {
        guard let selection else { return }
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: selection).addClip()
        for mark in marks {
            drawMark(mark, offset: selection.origin)
        }
        if let draftMark {
            drawMark(draftMark, offset: selection.origin)
        }
        NSGraphicsContext.restoreGraphicsState()
    }

    private func drawMark(_ mark: CaptureMark, offset: CGPoint) {
        mark.color.setStroke()
        mark.color.setFill()
        let path = NSBezierPath()
        path.lineWidth = mark.lineWidth
        path.lineCapStyle = .round
        path.lineJoinStyle = .round

        switch mark.kind {
        case .rect:
            path.appendRect(offsetRect(normalizedRect(from: mark.start, to: mark.end), by: offset))
            path.stroke()
        case .ellipse:
            path.appendOval(in: offsetRect(normalizedRect(from: mark.start, to: mark.end), by: offset))
            path.stroke()
        case .arrow:
            let start = offsetPoint(mark.start, by: offset)
            let end = offsetPoint(mark.end, by: offset)
            path.move(to: start)
            path.line(to: end)
            path.stroke()
            drawOverlayArrowHead(start: start, end: end, color: mark.color, lineWidth: mark.lineWidth)
        case .pen:
            guard let first = mark.points.first else { return }
            path.move(to: offsetPoint(first, by: offset))
            for point in mark.points.dropFirst() {
                path.line(to: offsetPoint(point, by: offset))
            }
            path.stroke()
        case .text:
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 18, weight: .bold),
                .foregroundColor: mark.color,
            ]
            mark.text.draw(at: offsetPoint(mark.start, by: offset), withAttributes: attributes)
        }
    }

    private func drawOverlayArrowHead(start: CGPoint, end: CGPoint, color: NSColor, lineWidth: CGFloat) {
        let angle = atan2(end.y - start.y, end.x - start.x)
        let length = max(13, lineWidth * 4)
        let left = CGPoint(
            x: end.x - length * cos(angle - .pi / 6),
            y: end.y - length * sin(angle - .pi / 6)
        )
        let right = CGPoint(
            x: end.x - length * cos(angle + .pi / 6),
            y: end.y - length * sin(angle + .pi / 6)
        )
        let head = NSBezierPath()
        head.move(to: end)
        head.line(to: left)
        head.line(to: right)
        head.close()
        color.setFill()
        head.fill()
    }

    private func drawToolbar(for rect: CGRect) {
        let toolbar = toolbarRect(for: rect)
        NSColor.white.withAlphaComponent(0.96).setFill()
        NSBezierPath(roundedRect: toolbar, xRadius: 7, yRadius: 7).fill()
        NSColor.black.withAlphaComponent(0.08).setStroke()
        let toolbarBorder = NSBezierPath(roundedRect: toolbar, xRadius: 7, yRadius: 7)
        toolbarBorder.lineWidth = 1
        toolbarBorder.stroke()

        for (index, item) in toolbarItems.enumerated() {
            let button = buttonRect(at: index, in: toolbar)
            let isCancel = isCancelItem(item)
            let isActive = isActiveTool(item)
            if isActive {
                NSColor.systemYellow.withAlphaComponent(0.18).setFill()
                NSBezierPath(roundedRect: button, xRadius: 5, yRadius: 5).fill()
            }
            drawToolbarIcon(item, in: button, isActive: isActive, isCancel: isCancel)
        }
    }

    private func toolbarAction(at point: CGPoint) -> ToolbarHit? {
        guard let selection, selection.width >= minimumSelectionSize, selection.height >= minimumSelectionSize else {
            return nil
        }
        let toolbar = toolbarRect(for: selection)
        guard toolbar.contains(point) else { return nil }
        for (index, item) in toolbarItems.enumerated() {
            if buttonRect(at: index, in: toolbar).contains(point) {
                switch item {
                case .tool(let tool):
                    return .tool(tool)
                case .undo:
                    return .undo
                case .action(let action):
                    return .action(action)
                case .confirm:
                    return .confirm
                }
            }
        }
        return nil
    }

    private func toolbarRect(for selection: CGRect) -> CGRect {
        let width = min(CGFloat(560), max(CGFloat(320), bounds.width - 24))
        let height: CGFloat = 44
        let x = min(max(12, selection.minX), bounds.width - width - 12)
        let below = selection.maxY + 10
        let y = below + height <= bounds.height - 12 ? below : max(12, selection.minY - height - 10)
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private func buttonRect(at index: Int, in toolbar: CGRect) -> CGRect {
        let gap: CGFloat = 8
        let width = (toolbar.width - gap * CGFloat(toolbarItems.count + 1)) / CGFloat(toolbarItems.count)
        return CGRect(
            x: toolbar.minX + gap + CGFloat(index) * (width + gap),
            y: toolbar.minY + 7,
            width: width,
            height: toolbar.height - 14
        )
    }

    private func handleToolbarHit(_ hit: ToolbarHit) {
        switch hit {
        case .tool(let tool):
            selectedTool = selectedTool == tool ? nil : tool
        case .undo:
            undoMark()
        case .action(let action):
            coordinator?.finish(action: action, selection: selection, screen: screen, marks: marks)
        case .confirm:
            coordinator?.finish(action: defaultAction ?? .save, selection: selection, screen: screen, marks: marks)
        }
        needsDisplay = true
    }

    private func startMark(at point: CGPoint) {
        guard let selection else { return }
        guard let selectedTool else { return }
        let local = CGPoint(x: point.x - selection.minX, y: point.y - selection.minY)
        if selectedTool == .text {
            beginInlineText(at: local)
            return
        }

        dragStart = point
        isDrawingMark = true
        draftMark = CaptureMark(
            kind: markKind(for: selectedTool),
            start: local,
            end: local,
            points: selectedTool == .pen ? [local] : [],
            text: "",
            color: markColor,
            lineWidth: markLineWidth
        )
    }

    private func startNewSelection(at point: CGPoint) {
        dragStart = point
        selection = CGRect(origin: point, size: .zero)
        isSelecting = true
        isMovingSelection = false
        isResizingSelection = false
        isDrawingMark = false
        activeHandle = nil
        interactionStart = nil
        originalSelection = nil
        marks.removeAll()
        draftMark = nil
        cancelInlineText()
    }

    private func startMoveSelection(at point: CGPoint) {
        dragStart = point
        interactionStart = point
        originalSelection = selection
        isMovingSelection = true
        isResizingSelection = false
        isSelecting = false
        isDrawingMark = false
        activeHandle = nil
        cancelInlineText()
    }

    private func startResize(handle: SelectionHandle, at point: CGPoint) {
        dragStart = point
        interactionStart = point
        originalSelection = selection
        activeHandle = handle
        isResizingSelection = true
        isMovingSelection = false
        isSelecting = false
        isDrawingMark = false
        cancelInlineText()
    }

    private func updateMovedSelection(to point: CGPoint) {
        guard let originalSelection, let interactionStart else { return }
        let dx = point.x - interactionStart.x
        let dy = point.y - interactionStart.y
        let x = min(max(0, originalSelection.minX + dx), max(0, bounds.width - originalSelection.width))
        let y = min(max(0, originalSelection.minY + dy), max(0, bounds.height - originalSelection.height))
        selection = CGRect(origin: CGPoint(x: x, y: y), size: originalSelection.size)
    }

    private func updateResizedSelection(to point: CGPoint) {
        guard let originalSelection, let activeHandle else { return }
        var minX = originalSelection.minX
        var maxX = originalSelection.maxX
        var minY = originalSelection.minY
        var maxY = originalSelection.maxY

        switch activeHandle {
        case .topLeft:
            minX = point.x
            minY = point.y
        case .top:
            minY = point.y
        case .topRight:
            maxX = point.x
            minY = point.y
        case .right:
            maxX = point.x
        case .bottomRight:
            maxX = point.x
            maxY = point.y
        case .bottom:
            maxY = point.y
        case .bottomLeft:
            minX = point.x
            maxY = point.y
        case .left:
            minX = point.x
        }

        minX = min(max(0, minX), bounds.width)
        maxX = min(max(0, maxX), bounds.width)
        minY = min(max(0, minY), bounds.height)
        maxY = min(max(0, maxY), bounds.height)

        var rect = CGRect(
            x: min(minX, maxX),
            y: min(minY, maxY),
            width: abs(maxX - minX),
            height: abs(maxY - minY)
        )
        if rect.width < minimumSelectionSize {
            rect.size.width = minimumSelectionSize
            rect.origin.x = min(rect.origin.x, bounds.width - rect.width)
        }
        if rect.height < minimumSelectionSize {
            rect.size.height = minimumSelectionSize
            rect.origin.y = min(rect.origin.y, bounds.height - rect.height)
        }
        selection = rect
    }

    private func endSelectionTransform() {
        isMovingSelection = false
        isResizingSelection = false
        activeHandle = nil
        dragStart = nil
        interactionStart = nil
        originalSelection = nil
        needsDisplay = true
    }

    private func updateDraftMark(at point: CGPoint) {
        guard let selection else { return }
        let local = CGPoint(
            x: min(max(0, point.x - selection.minX), selection.width),
            y: min(max(0, point.y - selection.minY), selection.height)
        )
        if draftMark?.kind == .pen {
            draftMark?.points.append(local)
        } else {
            draftMark?.end = local
        }
    }

    private func commitDraftMark() {
        isDrawingMark = false
        dragStart = nil
        if let draftMark {
            marks.append(draftMark)
        }
        draftMark = nil
        needsDisplay = true
    }

    private func undoMark() {
        if textField != nil {
            cancelInlineText()
            return
        }
        if draftMark != nil {
            draftMark = nil
        } else if !marks.isEmpty {
            marks.removeLast()
        }
        needsDisplay = true
    }

    private func beginInlineText(at localPoint: CGPoint) {
        guard let selection else { return }
        cancelInlineText()
        let field = InlineTextField(frame: CGRect(
            x: selection.minX + localPoint.x,
            y: selection.minY + localPoint.y,
            width: min(260, max(120, selection.width - localPoint.x)),
            height: 30
        ))
        field.font = NSFont.systemFont(ofSize: 18, weight: .bold)
        field.textColor = markColor
        field.backgroundColor = NSColor.white.withAlphaComponent(0.9)
        field.isBordered = true
        field.isBezeled = true
        field.focusRingType = .none
        field.placeholderString = "文字"
        field.onCommit = { [weak self, weak field] in
            self?.commitInlineText(field?.stringValue ?? "")
        }
        field.onCancel = { [weak self] in
            self?.cancelInlineText()
        }
        addSubview(field)
        textField = field
        textFieldLocalPoint = localPoint
        captureWindow?.makeKey()
        window?.makeFirstResponder(field)
    }

    private func commitInlineText(_ value: String) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        defer { cancelInlineText() }
        guard !text.isEmpty, let point = textFieldLocalPoint else { return }
        marks.append(CaptureMark(
            kind: .text,
            start: point,
            end: point,
            points: [],
            text: text,
            color: markColor,
            lineWidth: markLineWidth
        ))
        needsDisplay = true
    }

    private func cancelInlineText() {
        textField?.removeFromSuperview()
        textField = nil
        textFieldLocalPoint = nil
    }

    private func markKind(for tool: CaptureTool) -> MarkKind {
        switch tool {
        case .rect:
            return .rect
        case .ellipse:
            return .ellipse
        case .arrow:
            return .arrow
        case .pen:
            return .pen
        case .text:
            return .text
        }
    }

    private func isCancelItem(_ item: ToolbarItem) -> Bool {
        if case .action(.cancel) = item {
            return true
        }
        return false
    }

    private func isActiveTool(_ item: ToolbarItem) -> Bool {
        if case .tool(let tool) = item {
            return tool == selectedTool
        }
        return false
    }

    private func updateCursor(at point: CGPoint) {
        cursor(for: point).set()
    }

    private func cursor(for point: CGPoint) -> NSCursor {
        if toolbarAction(at: point) != nil {
            return .pointingHand
        }
        guard let selection, selection.width >= minimumSelectionSize, selection.height >= minimumSelectionSize else {
            return .crosshair
        }
        if let handle = activeHandle ?? selectionHandle(at: point, in: selection) {
            return cursor(for: handle)
        }
        if selection.contains(point) {
            if isMovingSelection {
                return .closedHand
            }
            if selectedTool == .text {
                return .iBeam
            }
            if selectedTool != nil {
                return .crosshair
            }
            return .openHand
        }
        return .crosshair
    }

    private func cursor(for handle: SelectionHandle) -> NSCursor {
        switch handle {
        case .top, .bottom:
            return .resizeUpDown
        case .left, .right:
            return .resizeLeftRight
        case .topLeft, .bottomRight:
            return diagonalResizeCursor(descending: true)
        case .topRight, .bottomLeft:
            return diagonalResizeCursor(descending: false)
        }
    }

    private func diagonalResizeCursor(descending: Bool) -> NSCursor {
        let size = NSSize(width: 22, height: 22)
        let image = NSImage(size: size, flipped: false) { rect in
            NSColor.clear.setFill()
            rect.fill()
            NSColor.black.withAlphaComponent(0.78).setStroke()
            let path = NSBezierPath()
            path.lineWidth = 2
            path.lineCapStyle = .round
            let start = descending ? CGPoint(x: 5, y: 17) : CGPoint(x: 5, y: 5)
            let end = descending ? CGPoint(x: 17, y: 5) : CGPoint(x: 17, y: 17)
            path.move(to: start)
            path.line(to: end)
            path.stroke()
            self.drawCursorArrowHead(from: start, to: end)
            self.drawCursorArrowHead(from: end, to: start)
            return true
        }
        return NSCursor(image: image, hotSpot: CGPoint(x: size.width / 2, y: size.height / 2))
    }

    private func drawCursorArrowHead(from start: CGPoint, to end: CGPoint) {
        let angle = atan2(end.y - start.y, end.x - start.x)
        let length: CGFloat = 5
        let left = CGPoint(
            x: end.x - length * cos(angle - .pi / 5),
            y: end.y - length * sin(angle - .pi / 5)
        )
        let right = CGPoint(
            x: end.x - length * cos(angle + .pi / 5),
            y: end.y - length * sin(angle + .pi / 5)
        )
        let head = NSBezierPath()
        head.lineWidth = 2
        head.lineCapStyle = .round
        head.move(to: end)
        head.line(to: left)
        head.move(to: end)
        head.line(to: right)
        head.stroke()
    }

    private func selectionHandle(at point: CGPoint, in rect: CGRect) -> SelectionHandle? {
        SelectionHandle.allCases.first { handleRect(for: $0, in: rect).contains(point) }
    }

    private func drawSelectionHandles(for rect: CGRect) {
        NSColor.white.setFill()
        NSColor.systemBlue.setStroke()
        for handle in SelectionHandle.allCases {
            let circle = NSBezierPath(ovalIn: handleRect(for: handle, in: rect))
            circle.lineWidth = 3
            circle.fill()
            circle.stroke()
        }
    }

    private func handleRect(for handle: SelectionHandle, in rect: CGRect) -> CGRect {
        let point = handlePoint(for: handle, in: rect)
        let size: CGFloat = 14
        return CGRect(x: point.x - size / 2, y: point.y - size / 2, width: size, height: size)
    }

    private func handlePoint(for handle: SelectionHandle, in rect: CGRect) -> CGPoint {
        switch handle {
        case .topLeft:
            return CGPoint(x: rect.minX, y: rect.minY)
        case .top:
            return CGPoint(x: rect.midX, y: rect.minY)
        case .topRight:
            return CGPoint(x: rect.maxX, y: rect.minY)
        case .right:
            return CGPoint(x: rect.maxX, y: rect.midY)
        case .bottomRight:
            return CGPoint(x: rect.maxX, y: rect.maxY)
        case .bottom:
            return CGPoint(x: rect.midX, y: rect.maxY)
        case .bottomLeft:
            return CGPoint(x: rect.minX, y: rect.maxY)
        case .left:
            return CGPoint(x: rect.minX, y: rect.midY)
        }
    }

    private func drawToolbarIcon(_ item: ToolbarItem, in rect: CGRect, isActive: Bool, isCancel: Bool) {
        let color = toolbarIconColor(for: item, isActive: isActive, isCancel: isCancel)
        let iconRect = squareIconRect(in: rect)
        color.setStroke()
        color.setFill()
        switch item {
        case .tool(let tool):
            drawToolIcon(tool, in: iconRect, color: color)
        case .undo:
            drawUndoIcon(in: iconRect, color: color)
        case .action(let action):
            drawActionIcon(action, in: iconRect, color: color)
        case .confirm:
            drawCheckIcon(in: iconRect, color: color)
        }
    }

    private func toolbarIconColor(for item: ToolbarItem, isActive: Bool, isCancel: Bool) -> NSColor {
        if isCancel {
            return .black.withAlphaComponent(0.82)
        }
        if isActive {
            return .systemBlue
        }
        switch item {
        case .tool(.pen):
            return .systemCyan
        case .undo:
            return .systemGray
        default:
            return .black.withAlphaComponent(0.82)
        }
    }

    private func squareIconRect(in rect: CGRect) -> CGRect {
        let side = min(rect.width, rect.height, 26)
        return CGRect(
            x: rect.midX - side / 2,
            y: rect.midY - side / 2,
            width: side,
            height: side
        )
    }

    private func drawToolIcon(_ tool: CaptureTool, in rect: CGRect, color: NSColor) {
        switch tool {
        case .rect:
            let icon = rect.insetBy(dx: 6, dy: 7)
            let path = NSBezierPath(rect: icon)
            path.lineWidth = 1.8
            path.stroke()
            drawYellowControlDot(at: CGPoint(x: icon.midX + icon.width * 0.2, y: icon.midY))
        case .ellipse:
            let icon = rect.insetBy(dx: 5.5, dy: 5.5)
            let path = NSBezierPath(ovalIn: icon)
            path.lineWidth = 1.8
            path.stroke()
            drawYellowControlDot(at: CGPoint(x: icon.midX, y: icon.midY))
        case .arrow:
            let start = CGPoint(x: rect.minX + 7, y: rect.maxY - 8)
            let end = CGPoint(x: rect.maxX - 7, y: rect.minY + 7)
            let path = NSBezierPath()
            path.lineWidth = 2
            path.lineCapStyle = .round
            path.move(to: start)
            path.line(to: end)
            path.stroke()
            drawToolbarArrowHead(start: start, end: end, color: color, lineWidth: 2)
        case .pen:
            let path = NSBezierPath()
            path.lineWidth = 2.2
            path.lineCapStyle = .round
            path.move(to: CGPoint(x: rect.minX + 8, y: rect.maxY - 7))
            path.line(to: CGPoint(x: rect.maxX - 8, y: rect.minY + 9))
            path.stroke()
            let cap = NSBezierPath()
            cap.lineWidth = 1.7
            cap.move(to: CGPoint(x: rect.maxX - 11, y: rect.minY + 7))
            cap.line(to: CGPoint(x: rect.maxX - 6, y: rect.minY + 12))
            cap.stroke()
        case .text:
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 19, weight: .regular),
                .foregroundColor: color,
            ]
            let label = "A"
            let size = label.size(withAttributes: attributes)
            label.draw(at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2), withAttributes: attributes)
        }
    }

    private func drawYellowControlDot(at point: CGPoint) {
        NSColor.systemYellow.setFill()
        NSBezierPath(ovalIn: CGRect(x: point.x - 3, y: point.y - 3, width: 6, height: 6)).fill()
    }

    private func drawActionIcon(_ action: CaptureAction, in rect: CGRect, color: NSColor) {
        switch action {
        case .save:
            drawDownloadIcon(in: rect, color: color)
        case .copy:
            drawCopyIcon(in: rect, color: color)
        case .ocr:
            drawOcrBadgeIcon(in: rect)
        case .cancel:
            drawCloseIcon(in: rect, color: color)
        }
    }

    private func drawUndoIcon(in rect: CGRect, color: NSColor) {
        let path = NSBezierPath()
        path.lineWidth = 2
        path.lineCapStyle = .round
        path.move(to: CGPoint(x: rect.maxX - 8, y: rect.midY + 4))
        path.curve(
            to: CGPoint(x: rect.minX + 10, y: rect.midY + 2),
            controlPoint1: CGPoint(x: rect.maxX - 14, y: rect.minY + 6),
            controlPoint2: CGPoint(x: rect.minX + 12, y: rect.minY + 8)
        )
        path.stroke()
        let head = NSBezierPath()
        head.lineWidth = 2
        head.lineCapStyle = .round
        head.move(to: CGPoint(x: rect.minX + 10, y: rect.midY + 2))
        head.line(to: CGPoint(x: rect.minX + 15, y: rect.midY - 3))
        head.move(to: CGPoint(x: rect.minX + 10, y: rect.midY + 2))
        head.line(to: CGPoint(x: rect.minX + 16, y: rect.midY + 5))
        head.stroke()
    }

    private func drawOcrBadgeIcon(in rect: CGRect) {
        let badge = CGRect(x: rect.midX - 10.5, y: rect.midY - 7, width: 21, height: 14)
        NSColor.black.setFill()
        NSBezierPath(roundedRect: badge, xRadius: 2.5, yRadius: 2.5).fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 7, weight: .bold),
            .foregroundColor: NSColor.white,
            .kern: -0.2,
        ]
        let label = "OCR"
        let size = label.size(withAttributes: attributes)
        label.draw(
            at: CGPoint(x: badge.midX - size.width / 2, y: badge.midY - size.height / 2),
            withAttributes: attributes
        )
    }

    private func drawCopyIcon(in rect: CGRect, color: NSColor) {
        let back = CGRect(x: rect.minX + 7, y: rect.minY + 9, width: 12, height: 12)
        let front = CGRect(x: rect.minX + 11, y: rect.minY + 6, width: 12, height: 12)
        let backPath = NSBezierPath(rect: back)
        let frontPath = NSBezierPath(rect: front)
        backPath.lineWidth = 1.6
        frontPath.lineWidth = 1.8
        backPath.stroke()
        frontPath.stroke()
    }

    private func drawDownloadIcon(in rect: CGRect, color: NSColor) {
        let path = NSBezierPath()
        path.lineWidth = 2
        path.lineCapStyle = .round
        path.move(to: CGPoint(x: rect.midX, y: rect.minY + 6))
        path.line(to: CGPoint(x: rect.midX, y: rect.maxY - 10))
        path.move(to: CGPoint(x: rect.midX - 5, y: rect.maxY - 14))
        path.line(to: CGPoint(x: rect.midX, y: rect.maxY - 9))
        path.line(to: CGPoint(x: rect.midX + 5, y: rect.maxY - 14))
        path.move(to: CGPoint(x: rect.minX + 7, y: rect.maxY - 6))
        path.line(to: CGPoint(x: rect.maxX - 7, y: rect.maxY - 6))
        path.stroke()
    }

    private func drawCloseIcon(in rect: CGRect, color: NSColor) {
        let path = NSBezierPath()
        path.lineWidth = 2
        path.lineCapStyle = .round
        path.move(to: CGPoint(x: rect.minX + 8, y: rect.minY + 8))
        path.line(to: CGPoint(x: rect.maxX - 8, y: rect.maxY - 8))
        path.move(to: CGPoint(x: rect.maxX - 8, y: rect.minY + 8))
        path.line(to: CGPoint(x: rect.minX + 8, y: rect.maxY - 8))
        path.stroke()
    }

    private func drawCheckIcon(in rect: CGRect, color: NSColor) {
        let path = NSBezierPath()
        path.lineWidth = 2.2
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.move(to: CGPoint(x: rect.minX + 7, y: rect.midY + 1))
        path.line(to: CGPoint(x: rect.midX - 1, y: rect.maxY - 8))
        path.line(to: CGPoint(x: rect.maxX - 6, y: rect.minY + 7))
        path.stroke()
    }

    private func drawToolbarArrowHead(start: CGPoint, end: CGPoint, color: NSColor, lineWidth: CGFloat) {
        let angle = atan2(end.y - start.y, end.x - start.x)
        let length = max(8, lineWidth * 4)
        let left = CGPoint(
            x: end.x - length * cos(angle - .pi / 6),
            y: end.y - length * sin(angle - .pi / 6)
        )
        let right = CGPoint(
            x: end.x - length * cos(angle + .pi / 6),
            y: end.y - length * sin(angle + .pi / 6)
        )
        let head = NSBezierPath()
        head.lineWidth = lineWidth
        head.lineCapStyle = .round
        head.lineJoinStyle = .round
        head.move(to: end)
        head.line(to: left)
        head.move(to: end)
        head.line(to: right)
        head.stroke()
    }

    private func offsetPoint(_ point: CGPoint, by offset: CGPoint) -> CGPoint {
        CGPoint(x: point.x + offset.x, y: point.y + offset.y)
    }

    private func offsetRect(_ rect: CGRect, by offset: CGPoint) -> CGRect {
        CGRect(x: rect.minX + offset.x, y: rect.minY + offset.y, width: rect.width, height: rect.height)
    }

    private func clamped(_ point: CGPoint) -> CGPoint {
        CGPoint(
            x: min(max(0, point.x), bounds.width),
            y: min(max(0, point.y), bounds.height)
        )
    }

    private func normalizedRect(from start: CGPoint, to end: CGPoint) -> CGRect {
        CGRect(
            x: min(start.x, end.x),
            y: min(start.y, end.y),
            width: abs(end.x - start.x),
            height: abs(end.y - start.y)
        )
    }
}

final class InlineTextField: NSTextField {
    var onCommit: (() -> Void)?
    var onCancel: (() -> Void)?
    private var didFinish = false

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.keyCode == 76 {
            finish(commit: true)
            return
        }
        if event.keyCode == 53 {
            finish(commit: false)
            return
        }
        super.keyDown(with: event)
    }

    override func textDidEndEditing(_ notification: Notification) {
        super.textDidEndEditing(notification)
        finish(commit: true)
    }

    private func finish(commit: Bool) {
        guard !didFinish else { return }
        didFinish = true
        if commit {
            onCommit?()
        } else {
            onCancel?()
        }
    }
}

struct CaptureServiceRequest {
    let requestID: String
    let args: CaptureArguments

    static func parse(raw: [String: Any], fallbackOutputDir: URL) throws -> CaptureServiceRequest {
        guard let command = raw["command"] as? String, command == "capture" else {
            throw CaptureError.message("service 请求缺少 capture 指令。")
        }

        guard let requestID = raw["requestId"] as? String, !requestID.isEmpty else {
            throw CaptureError.message("service 请求缺少 requestId。")
        }

        let outputDir = (raw["outputDir"] as? String)
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? fallbackOutputDir

        let defaultAction: CaptureAction?
        if let actionText = raw["defaultAction"] as? String, !actionText.isEmpty {
            guard let action = CaptureAction(rawValue: actionText), action != .cancel else {
                throw CaptureError.message("service 请求包含不支持的默认动作: \(actionText)。")
            }
            defaultAction = action
        } else {
            defaultAction = nil
        }

        return CaptureServiceRequest(
            requestID: requestID,
            args: CaptureArguments(
                outputDir: outputDir,
                defaultAction: defaultAction,
                validateOnly: false,
                selfTestRenderOnly: false,
                serviceMode: true
            )
        )
    }
}

final class CaptureService {
    private let fallbackArgs: CaptureArguments
    private let writer = JSONLineWriter()
    private var coordinator: CaptureCoordinator?
    private var inputBuffer = Data()

    init(fallbackArgs: CaptureArguments) {
        self.fallbackArgs = fallbackArgs
    }

    func start() {
        writer.write([
            "action": "ready",
            "message": "moshi-capture-helper service ready",
        ])

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = [UInt8](repeating: 0, count: 4096)
            let bufferSize = buffer.count
            while true {
                let count = buffer.withUnsafeMutableBytes { pointer in
                    read(STDIN_FILENO, pointer.baseAddress, bufferSize)
                }
                if count > 0 {
                    let chunk = Data(buffer.prefix(count))
                    DispatchQueue.main.async {
                        self?.consume(chunk)
                    }
                    continue
                }

                DispatchQueue.main.async {
                    self?.stop()
                }
                break
            }
        }
    }

    private func consume(_ data: Data) {
        inputBuffer.append(data)
        while let newline = inputBuffer.firstIndex(of: 10) {
            let lineData = inputBuffer[..<newline]
            inputBuffer.removeSubrange(...newline)
            guard let line = String(data: lineData, encoding: .utf8) else {
                writer.write([
                    "action": "error",
                    "message": "service 请求不是 UTF-8 文本。",
                ])
                continue
            }
            handle(line: line)
        }
    }

    private func stop() {
        DispatchQueue.main.async {
            NSApp.terminate(nil)
        }
    }

    private func handle(line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        do {
            guard let data = trimmed.data(using: .utf8),
                  let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw CaptureError.message("service 请求不是合法 JSON。")
            }

            let command = raw["command"] as? String
            if command == "ping" {
                writer.write([
                    "action": "ready",
                    "message": "moshi-capture-helper service ready",
                ])
                return
            }
            if command == "shutdown" {
                writer.write([
                    "action": "shutdown",
                    "message": "moshi-capture-helper service stopped",
                ])
                stop()
                return
            }

            let request = try CaptureServiceRequest.parse(
                raw: raw,
                fallbackOutputDir: fallbackArgs.outputDir
            )
            startCapture(request)
        } catch {
            writer.write([
                "action": "error",
                "message": String(describing: error),
            ])
        }
    }

    private func startCapture(_ request: CaptureServiceRequest) {
        guard coordinator == nil else {
            writer.write([
                "requestId": request.requestID,
                "action": "error",
                "message": "已有截图任务正在进行。",
            ])
            return
        }

        let coordinator = CaptureCoordinator(
            args: request.args,
            terminateOnFinish: false
        ) { [weak self] payload, _ in
            guard let self else { return }
            var response = payload
            response["requestId"] = request.requestID
            self.writer.write(response)
            self.coordinator = nil
        }
        self.coordinator = coordinator
        coordinator.start()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var args: CaptureArguments?
    private var coordinator: CaptureCoordinator?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let args else {
            fputs("moshi-capture-helper: 缺少启动参数。\n", stderr)
            exit(1)
        }
        coordinator = CaptureCoordinator(args: args)
        coordinator?.start()
    }
}

do {
    let args = try CaptureArguments.parse()
    if args.validateOnly {
        print("{\"ok\":true}")
        exit(0)
    }
    if args.selfTestRenderOnly {
        CaptureCoordinator(args: args).runSelfTestRender()
        exit(0)
    }

    let app = NSApplication.shared
    if args.serviceMode {
        let service = CaptureService(fallbackArgs: args)
        service.start()
        app.run()
        _ = service
        exit(0)
    }

    let delegate = AppDelegate()
    delegate.args = args
    app.delegate = delegate
    app.run()
} catch {
    if let data = try? JSONSerialization.data(withJSONObject: ["action": "error", "message": String(describing: error)]),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    }
    fputs("moshi-capture-helper: \(error)\n", stderr)
    exit(1)
}
