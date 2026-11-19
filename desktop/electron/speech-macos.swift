import Foundation
import AVFoundation

struct SpeechRequest: Decodable { let action: String; let text: String?; let voice: String? }
struct Voice: Encodable { let name: String; let language: String }
enum SpeechFailure: Error { case invalidRequest, noVoice, audioFormat, audioLimit, timeout }

// Select the same installed voice for listing and synthesis, including when
// macOS offers several qualities with the same display name.
func installedVoices() -> [AVSpeechSynthesisVoice] {
    var selected: [String: AVSpeechSynthesisVoice] = [:]
    for voice in AVSpeechSynthesisVoice.speechVoices().sorted(by: { $0.identifier < $1.identifier }) {
        if selected[voice.name] == nil || selected[voice.name]!.quality.rawValue < voice.quality.rawValue {
            selected[voice.name] = voice
        }
    }
    return selected.values.sorted { ($0.language, $0.name) < ($1.language, $1.name) }
}
func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var encoded = value.littleEndian
    withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
}
func synthesize(_ request: SpeechRequest) throws -> Data {
    guard let text = request.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          text.utf16.count <= 2400, let name = request.voice,
          let voice = installedVoices().first(where: { $0.name == name }) else { throw SpeechFailure.noVoice }
    let speaker = AVSpeechSynthesizer(), utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice
    let lock = NSLock()
    var pcm = Data(), sampleRate: Double = 0, channels: AVAudioChannelCount = 0
    var finished = false, failure: Error? = nil
    speaker.write(utterance) { audio in
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }
        guard let buffer = audio as? AVAudioPCMBuffer else { failure = SpeechFailure.audioFormat; finished = true; return }
        if buffer.frameLength == 0 { finished = true; return }
        guard buffer.format.commonFormat == .pcmFormatFloat32, let samples = buffer.floatChannelData,
              buffer.format.channelCount > 0, buffer.format.channelCount <= 2 else {
            failure = SpeechFailure.audioFormat; finished = true; return
        }
        if sampleRate == 0 { sampleRate = buffer.format.sampleRate; channels = buffer.format.channelCount }
        guard sampleRate == buffer.format.sampleRate, channels == buffer.format.channelCount else {
            failure = SpeechFailure.audioFormat; finished = true; return
        }
        let extraBytes = Int(buffer.frameLength) * Int(channels) * 2
        guard pcm.count + extraBytes < 16 * 1024 * 1024 else { failure = SpeechFailure.audioLimit; finished = true; return }
        pcm.reserveCapacity(pcm.count + extraBytes)
        for frame in 0..<Int(buffer.frameLength) {
            for channel in 0..<Int(channels) {
                let value = buffer.format.isInterleaved ? samples[0][frame * Int(channels) + channel] : samples[channel][frame]
                let bounded = value.isFinite ? max(-1, min(1, value)) : 0
                appendLittleEndian(Int16(bounded * 32767), to: &pcm)
            }
        }
    }
    let deadline = Date().addingTimeInterval(40)
    while true {
        lock.lock(); let done = finished; lock.unlock()
        if done { break }
        if Date() > deadline { speaker.stopSpeaking(at: .immediate); throw SpeechFailure.timeout }
        RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }
    lock.lock(); defer { lock.unlock() }
    if let error = failure { throw error }
    guard !pcm.isEmpty, sampleRate > 0 else { throw SpeechFailure.audioFormat }
    var wav = Data("RIFF".utf8)
    appendLittleEndian(UInt32(36 + pcm.count), to: &wav); wav.append(Data("WAVEfmt ".utf8))
    appendLittleEndian(UInt32(16), to: &wav); appendLittleEndian(UInt16(1), to: &wav)
    appendLittleEndian(UInt16(channels), to: &wav); appendLittleEndian(UInt32(sampleRate), to: &wav)
    appendLittleEndian(UInt32(sampleRate) * UInt32(channels) * 2, to: &wav)
    appendLittleEndian(UInt16(channels) * 2, to: &wav); appendLittleEndian(UInt16(16), to: &wav)
    wav.append(Data("data".utf8)); appendLittleEndian(UInt32(pcm.count), to: &wav); wav.append(pcm)
    return wav
}
do {
    let bytes = FileHandle.standardInput.readDataToEndOfFile()
    guard bytes.count < 20000 else { throw SpeechFailure.invalidRequest }
    let request = try JSONDecoder().decode(SpeechRequest.self, from: bytes)
    if request.action == "voices" {
        FileHandle.standardOutput.write(try JSONEncoder().encode(installedVoices().map { Voice(name: $0.name, language: $0.language) }))
    } else if request.action == "synthesize" {
        FileHandle.standardOutput.write(Data(try synthesize(request).base64EncodedString().utf8))
    } else { throw SpeechFailure.invalidRequest }
} catch {
    FileHandle.standardError.write(Data("Não foi possível preparar a voz do macOS: \(error)\n".utf8))
    exit(1)
}
