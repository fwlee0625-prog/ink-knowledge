import AppKit
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Vision

struct OCRItem: Codable {
    let page: Int
    let text: String
    let source: String
    let score: Float?
    let box: [Double]?
    let polygon: [[Double]]?

    enum CodingKeys: String, CodingKey {
        case page
        case text
        case source
        case score
        case box
        case polygon
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(page, forKey: .page)
        try container.encode(text, forKey: .text)
        try container.encode(source, forKey: .source)

        if let score {
            try container.encode(score, forKey: .score)
        } else {
            try container.encodeNil(forKey: .score)
        }

        if let box {
            try container.encode(box, forKey: .box)
        } else {
            try container.encodeNil(forKey: .box)
        }

        if let polygon {
            try container.encode(polygon, forKey: .polygon)
        } else {
            try container.encodeNil(forKey: .polygon)
        }
    }
}

struct OCRDocument: Codable {
    let input: String
    let items: [OCRItem]
    let text: String
}

struct LegacyOptions {
    var imagePath: String?
    var page = 1
    var source: String?
    var languages = ["zh-Hans", "en-US"]
    var recognitionLevel = VNRequestTextRecognitionLevel.accurate
    var usesLanguageCorrection = true
}

struct RecognizeOptions {
    var inputPath: String?
    var outputDir = "output"
    var outputFormat = "both"
    var engine = "apple-vision"
    var dpi = 300
    var lang = "ch"
    var forceOCR = false
    var minTextChars = 8
    var recognitionLevel = VNRequestTextRecognitionLevel.accurate
    var usesLanguageCorrection = true
}

enum CLIError: Error, CustomStringConvertible {
    case missingInput
    case invalidValue(String)
    case unsupportedEngine(String)
    case unsupportedFormat(String)
    case unsupportedInput(String)
    case imageLoadFailed(String)
    case pdfLoadFailed(String)
    case pdfRenderFailed(Int)
    case outputWriteFailed(String)

    var description: String {
        switch self {
        case .missingInput:
            return "Missing input path."
        case .invalidValue(let value):
            return "Invalid value: \(value)"
        case .unsupportedEngine(let value):
            return "Unsupported OCR engine in native backend: \(value)"
        case .unsupportedFormat(let value):
            return "Unsupported output format: \(value)"
        case .unsupportedInput(let path):
            return "Unsupported input file: \(path)"
        case .imageLoadFailed(let path):
            return "Failed to load image: \(path)"
        case .pdfLoadFailed(let path):
            return "Failed to load PDF: \(path)"
        case .pdfRenderFailed(let page):
            return "Failed to render PDF page: \(page)"
        case .outputWriteFailed(let path):
            return "Failed to write output: \(path)"
        }
    }
}

func printHelp() {
    print(
        """
        moshi-ocr-native recognize INPUT [options]
        apple-vision-ocr IMAGE [--page N] [--lang zh-Hans,en-US] [--source PATH] [--fast]

        Commands:
          recognize INPUT             Recognize one image or PDF and write txt/json outputs.

        Options:
          -o, --output-dir DIR        Output directory. Default: output
          --format txt|json|both      Output format. Default: both
          --engine apple-vision       Native OCR engine. Default: apple-vision
          --dpi N                     PDF render DPI. Default: 300
          --lang LANG                 Language alias or comma-separated Vision languages.
          --force-ocr                 OCR PDF pages even when text layer exists.
          --min-text-chars N          Minimum PDF text layer chars to skip OCR. Default: 8
          --fast                      Use Vision fast recognition level.
          --no-language-correction    Disable Vision language correction.
        """
    )
}

func parseLegacyOptions(_ args: [String]) throws -> LegacyOptions {
    var options = LegacyOptions()
    var index = 0

    while index < args.count {
        let arg = args[index]
        switch arg {
        case "-h", "--help":
            printHelp()
            exit(0)
        case "--page":
            index += 1
            guard index < args.count, let page = Int(args[index]), page > 0 else {
                throw CLIError.invalidValue("--page")
            }
            options.page = page
        case "--lang":
            index += 1
            guard index < args.count else {
                throw CLIError.invalidValue("--lang")
            }
            options.languages = parseLanguages(args[index])
        case "--source":
            index += 1
            guard index < args.count else {
                throw CLIError.invalidValue("--source")
            }
            options.source = args[index]
        case "--fast":
            options.recognitionLevel = .fast
        case "--no-language-correction":
            options.usesLanguageCorrection = false
        default:
            if arg.hasPrefix("-") {
                throw CLIError.invalidValue(arg)
            }
            if options.imagePath == nil {
                options.imagePath = arg
            } else {
                throw CLIError.invalidValue(arg)
            }
        }
        index += 1
    }

    guard options.imagePath != nil else {
        throw CLIError.missingInput
    }
    return options
}

func parseRecognizeOptions(_ args: [String]) throws -> RecognizeOptions {
    var options = RecognizeOptions()
    var index = 0

    while index < args.count {
        let arg = args[index]
        switch arg {
        case "-h", "--help":
            printHelp()
            exit(0)
        case "-o", "--output-dir":
            index += 1
            guard index < args.count else {
                throw CLIError.invalidValue(arg)
            }
            options.outputDir = args[index]
        case "--format":
            index += 1
            guard index < args.count else {
                throw CLIError.invalidValue("--format")
            }
            let value = args[index].lowercased()
            guard ["txt", "json", "both"].contains(value) else {
                throw CLIError.unsupportedFormat(value)
            }
            options.outputFormat = value
        case "--engine":
            index += 1
            guard index < args.count else {
                throw CLIError.invalidValue("--engine")
            }
            options.engine = normalizeEngine(args[index])
        case "--dpi":
            index += 1
            guard index < args.count, let dpi = Int(args[index]), dpi > 0 else {
                throw CLIError.invalidValue("--dpi")
            }
            options.dpi = dpi
        case "--lang":
            index += 1
            guard index < args.count else {
                throw CLIError.invalidValue("--lang")
            }
            options.lang = args[index]
        case "--force-ocr":
            options.forceOCR = true
        case "--min-text-chars":
            index += 1
            guard index < args.count, let value = Int(args[index]), value >= 0 else {
                throw CLIError.invalidValue("--min-text-chars")
            }
            options.minTextChars = value
        case "--fast":
            options.recognitionLevel = .fast
        case "--no-language-correction":
            options.usesLanguageCorrection = false
        default:
            if arg.hasPrefix("-") {
                throw CLIError.invalidValue(arg)
            }
            if options.inputPath == nil {
                options.inputPath = arg
            } else {
                throw CLIError.invalidValue(arg)
            }
        }
        index += 1
    }

    guard options.inputPath != nil else {
        throw CLIError.missingInput
    }
    return options
}

func normalizeEngine(_ value: String) -> String {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "_", with: "-")
    switch normalized {
    case "apple", "vision", "applevision", "apple-vision":
        return "apple-vision"
    default:
        return normalized
    }
}

func parseLanguages(_ value: String) -> [String] {
    if value.contains(",") {
        let languages = value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return languages.isEmpty ? ["zh-Hans", "en-US"] : languages
    }

    switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "_", with: "-") {
    case "ch", "zh", "cn", "zh-cn", "zh-hans":
        return ["zh-Hans", "en-US"]
    case "cht", "tw", "zh-tw", "zh-hant":
        return ["zh-Hant", "en-US"]
    case "en", "en-us":
        return ["en-US"]
    case "ja", "jp", "ja-jp":
        return ["ja-JP"]
    case "ko", "kr", "ko-kr":
        return ["ko-KR"]
    default:
        return [value]
    }
}

func loadImage(_ path: String) throws -> (CGImage, Double, Double, CGImagePropertyOrientation) {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw CLIError.imageLoadFailed(path)
    }

    var orientation = CGImagePropertyOrientation.up
    if let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
       let raw = properties[kCGImagePropertyOrientation] as? UInt32,
       let parsed = CGImagePropertyOrientation(rawValue: raw) {
        orientation = parsed
    }

    return (image, Double(image.width), Double(image.height), orientation)
}

func recognizeImage(
    image: CGImage,
    width: Double,
    height: Double,
    orientation: CGImagePropertyOrientation,
    page: Int,
    source: String,
    languages: [String],
    recognitionLevel: VNRequestTextRecognitionLevel,
    usesLanguageCorrection: Bool
) throws -> [OCRItem] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = recognitionLevel
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = usesLanguageCorrection
    request.revision = VNRecognizeTextRequest.defaultRevision

    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    try handler.perform([request])

    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }
        let rect = observation.boundingBox
        let minX = rect.minX * width
        let maxX = rect.maxX * width
        let minY = (1.0 - rect.maxY) * height
        let maxY = (1.0 - rect.minY) * height
        let box = [minX, minY, maxX, maxY]
        let polygon = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
        ]
        return OCRItem(
            page: page,
            text: candidate.string,
            source: source,
            score: candidate.confidence,
            box: box,
            polygon: polygon
        )
    }
}

func recognizeLegacy(_ options: LegacyOptions) throws -> [OCRItem] {
    guard let imagePath = options.imagePath else {
        throw CLIError.missingInput
    }
    let (image, width, height, orientation) = try loadImage(imagePath)
    return try recognizeImage(
        image: image,
        width: width,
        height: height,
        orientation: orientation,
        page: options.page,
        source: options.source ?? imagePath,
        languages: options.languages,
        recognitionLevel: options.recognitionLevel,
        usesLanguageCorrection: options.usesLanguageCorrection
    )
}

func recognizeDocument(_ options: RecognizeOptions) throws -> OCRDocument {
    guard let inputPath = options.inputPath else {
        throw CLIError.missingInput
    }
    guard options.engine == "apple-vision" else {
        throw CLIError.unsupportedEngine(options.engine)
    }

    let inputURL = URL(fileURLWithPath: inputPath)
    let ext = inputURL.pathExtension.lowercased()
    let languages = parseLanguages(options.lang)
    let items: [OCRItem]

    if ext == "pdf" {
        items = try recognizePDF(inputURL, options: options, languages: languages)
    } else if isSupportedImageExtension(ext) {
        let (image, width, height, orientation) = try loadImage(inputPath)
        items = try recognizeImage(
            image: image,
            width: width,
            height: height,
            orientation: orientation,
            page: 1,
            source: inputPath,
            languages: languages,
            recognitionLevel: options.recognitionLevel,
            usesLanguageCorrection: options.usesLanguageCorrection
        )
    } else {
        throw CLIError.unsupportedInput(inputPath)
    }

    return OCRDocument(
        input: inputPath,
        items: items,
        text: items.map(\.text).filter { !$0.isEmpty }.joined(separator: "\n")
    )
}

func recognizePDF(_ url: URL, options: RecognizeOptions, languages: [String]) throws -> [OCRItem] {
    guard let document = PDFDocument(url: url) else {
        throw CLIError.pdfLoadFailed(url.path)
    }

    var items: [OCRItem] = []
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else {
            continue
        }
        let pageNumber = index + 1
        let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !options.forceOCR && text.count >= options.minTextChars {
            items.append(
                OCRItem(
                    page: pageNumber,
                    text: text,
                    source: "pdf_text_layer",
                    score: nil,
                    box: nil,
                    polygon: nil
                )
            )
            continue
        }

        let rendered = try renderPDFPage(page, pageNumber: pageNumber, dpi: options.dpi)
        let pageItems = try recognizeImage(
            image: rendered.image,
            width: rendered.width,
            height: rendered.height,
            orientation: .up,
            page: pageNumber,
            source: "\(url.path)#page-\(pageNumber)",
            languages: languages,
            recognitionLevel: options.recognitionLevel,
            usesLanguageCorrection: options.usesLanguageCorrection
        )
        items.append(contentsOf: pageItems)
    }
    return items
}

func renderPDFPage(_ page: PDFPage, pageNumber: Int, dpi: Int) throws -> (image: CGImage, width: Double, height: Double) {
    let bounds = page.bounds(for: .mediaBox)
    let scale = CGFloat(dpi) / 72.0
    let width = max(Int(ceil(bounds.width * scale)), 1)
    let height = max(Int(ceil(bounds.height * scale)), 1)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else {
        throw CLIError.pdfRenderFailed(pageNumber)
    }

    context.setFillColor(CGColor(gray: 1.0, alpha: 1.0))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()

    guard let image = context.makeImage() else {
        throw CLIError.pdfRenderFailed(pageNumber)
    }
    return (image, Double(width), Double(height))
}

func isSupportedImageExtension(_ ext: String) -> Bool {
    ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].contains(ext)
}

func writeOutputs(_ document: OCRDocument, options: RecognizeOptions) throws {
    guard let inputPath = options.inputPath else {
        throw CLIError.missingInput
    }
    let outputURL = URL(fileURLWithPath: options.outputDir)
    try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

    let stem = URL(fileURLWithPath: inputPath).deletingPathExtension().lastPathComponent
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

    if options.outputFormat == "json" || options.outputFormat == "both" {
        let jsonURL = outputURL.appendingPathComponent(stem).appendingPathExtension("json")
        do {
            try encoder.encode(document).write(to: jsonURL, options: .atomic)
        } catch {
            throw CLIError.outputWriteFailed(jsonURL.path)
        }
    }

    if options.outputFormat == "txt" || options.outputFormat == "both" {
        let txtURL = outputURL.appendingPathComponent(stem).appendingPathExtension("txt")
        do {
            try (document.text + "\n").write(to: txtURL, atomically: true, encoding: .utf8)
        } catch {
            throw CLIError.outputWriteFailed(txtURL.path)
        }
    }
}

do {
    var args = Array(CommandLine.arguments.dropFirst())
    if args.first == "-h" || args.first == "--help" {
        printHelp()
        exit(0)
    }

    if args.first == "recognize" {
        args.removeFirst()
        let options = try parseRecognizeOptions(args)
        let document = try recognizeDocument(options)
        try writeOutputs(document, options: options)
        print("OK \(options.inputPath ?? "") -> \(options.outputDir)")
    } else {
        let options = try parseLegacyOptions(args)
        let items = try recognizeLegacy(options)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(items))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
} catch {
    let message = "moshi-ocr-native: \(error)\n"
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
