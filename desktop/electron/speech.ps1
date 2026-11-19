$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    if ($request.action -eq 'voices') {
        $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
            @{ name = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name }
        })
        [Console]::Write((ConvertTo-Json -InputObject $voices -Compress))
    } elseif ($request.action -eq 'synthesize') {
        if ($request.voice) { $speaker.SelectVoice([string]$request.voice) }
        $stream = [System.IO.MemoryStream]::new()
        try {
            $speaker.SetOutputToWaveStream($stream)
            $speaker.Speak([string]$request.text)
            [Console]::Write([Convert]::ToBase64String($stream.ToArray()))
        } finally { $stream.Dispose() }
    } else { throw 'Invalid speech request.' }
} finally { $speaker.Dispose() }
