import Foundation
import ImageIO
import Vision

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

let args = CommandLine.arguments
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if args.count > 1 && args[1] == "--languages" {
    let tags = (try? request.supportedRecognitionLanguages()) ?? []
    print(tags.joined(separator: "\n"))
    exit(0)
}
guard args.count > 1 else { fail("usage: lime-ocr <image> [language]", 2) }
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("cannot read \(args[1])", 2)
}
if args.count > 2 && !args[2].isEmpty { request.recognitionLanguages = args[2].split(separator: ",").map(String.init) }
do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]) } catch { fail("recognition failed: \(error.localizedDescription)", 3) }

let width = Double(image.width), height = Double(image.height)
func box(_ r: CGRect) -> [Double] { [r.minX * width, (1 - r.maxY) * height, r.width * width, r.height * height] }
var lines: [[String: Any]] = []
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let text = candidate.string
    var words: [[String: Any]] = []
    var from = text.startIndex
    for word in text.split(separator: " ", omittingEmptySubsequences: true) {
        guard let range = text.range(of: String(word), range: from..<text.endIndex) else { continue }
        from = range.upperBound
        let rect = (try? candidate.boundingBox(for: range))?.boundingBox ?? observation.boundingBox
        words.append(["text": String(word), "box": box(rect)])
    }
    lines.append(["text": text, "box": box(observation.boundingBox), "words": words, "confidence": Double(candidate.confidence)])
}
let result: [String: Any] = ["width": width, "height": height, "lines": lines]
guard let json = try? JSONSerialization.data(withJSONObject: result) else { fail("cannot write the result", 3) }
FileHandle.standardOutput.write(json)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
