import AppKit
import Foundation
import UniformTypeIdentifiers

// 剪贴板读取 helper。一次性 CLI：读取当前 NSPasteboard 内容，输出一行 JSON。
// 不做轮询；轮询由 Rust 侧通过反复调用本 helper 并对比 changeCount 实现。
//
// 输出 JSON 结构（kind 按优先级：files > image > text；其余类型不支持）：
//   { "changeCount": Int, "kind": "files"|"image"|"text"|"unknown",
//     "text": String?, "imagePath": String?, "paths": [String]?,
//     "sizeBytes": Int?, "mimeType": String?, "isDir": Bool?,
//     "fileCount": Int? }
//
// 图片会落盘到 --image-dir 指定目录，文件名按 changeCount + 时间戳生成；
// 不生成缩略图，前端直接用 Tauri asset 协议加载。

struct PasteboardSnapshot: Codable {
    var changeCount: Int
    var kind: String
    var text: String?
    var imagePath: String?
    var paths: [String]?
    var sizeBytes: Int?
    var mimeType: String?
    var isDir: Bool?
    var fileCount: Int?
}

let args = CommandLine.arguments
var imageDir: String? = nil
for i in 0..<args.count {
    if args[i] == "--image-dir" && i + 1 < args.count {
        imageDir = args[i + 1]
    }
}

let pasteboard = NSPasteboard.general
let changeCount = pasteboard.changeCount

// 优先级 1：文件 URL（public.file-url），可能多个
if let fileURLs = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL],
   !fileURLs.isEmpty {
    var paths: [String] = []
    var totalSize: Int64 = 0
    var hasDir = false
    var mime: String? = nil
    for url in fileURLs {
        let path = url.path
        paths.append(path)
        let fm = FileManager.default
        var isDirObj: ObjCBool = false
        if fm.fileExists(atPath: path, isDirectory: &isDirObj) {
            if isDirObj.boolValue {
                hasDir = true
            } else {
                if let attrs = try? fm.attributesOfItem(atPath: path),
                   let size = attrs[.size] as? NSNumber {
                    totalSize += size.int64Value
                    if mime == nil, let utType = UTType(filenameExtension: url.pathExtension) {
                        mime = utType.preferredMIMEType
                    }
                }
            }
        }
    }
    // 文件夹总大小不在此处统计（耗时）；交给 Rust 侧按需异步计算
    let snapshot = PasteboardSnapshot(
        changeCount: changeCount,
        kind: "files",
        text: nil,
        imagePath: nil,
        paths: paths,
        sizeBytes: fileURLs.count == 1 && !hasDir ? Int(totalSize) : nil,
        mimeType: mime,
        isDir: fileURLs.count == 1 ? hasDir : nil,
        fileCount: fileURLs.count > 1 ? fileURLs.count : nil
    )
    let data = try! JSONEncoder().encode(snapshot)
    FileHandle.standardOutput.write(data)
    exit(0)
}

// 优先级 2：图片（NSImage，TIFF/PNG）
if let images = pasteboard.readObjects(forClasses: [NSImage.self], options: nil) as? [NSImage],
   let image = images.first {
    let tiffData = image.tiffRepresentation
    guard let tiffData = tiffData,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        let snapshot = PasteboardSnapshot(changeCount: changeCount, kind: "unknown")
        let data = try! JSONEncoder().encode(snapshot)
        FileHandle.standardOutput.write(data)
        exit(0)
    }
    var savedPath: String? = nil
    if let dir = imageDir {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let filename = "clip-\(changeCount)-\(Int(Date().timeIntervalSince1970)).png"
        let fullPath = (dir as NSString).appendingPathComponent(filename)
        try? pngData.write(to: URL(fileURLWithPath: fullPath))
        savedPath = fullPath
    }
    let snapshot = PasteboardSnapshot(
        changeCount: changeCount,
        kind: "image",
        text: nil,
        imagePath: savedPath,
        paths: nil,
        sizeBytes: pngData.count,
        mimeType: "image/png",
        isDir: nil,
        fileCount: nil
    )
    let data = try! JSONEncoder().encode(snapshot)
    FileHandle.standardOutput.write(data)
    exit(0)
}

// 优先级 3：纯文本
if let str = pasteboard.string(forType: .string), !str.isEmpty {
    let snapshot = PasteboardSnapshot(
        changeCount: changeCount,
        kind: "text",
        text: str,
        imagePath: nil,
        paths: nil,
        sizeBytes: nil,
        mimeType: "text/plain",
        isDir: nil,
        fileCount: nil
    )
    let data = try! JSONEncoder().encode(snapshot)
    FileHandle.standardOutput.write(data)
    exit(0)
}

// 其余类型（RTF、HTML 等）第一版不处理
let snapshot = PasteboardSnapshot(changeCount: changeCount, kind: "unknown")
let data = try! JSONEncoder().encode(snapshot)
FileHandle.standardOutput.write(data)
