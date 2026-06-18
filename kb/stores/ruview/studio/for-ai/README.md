# RuView — Studio outputs, for AI assistants

Plain-text companions to the NotebookLM **Studio** media that ships in `../for-humans/`.
Everything here is ingestible by an LLM/agent with no OCR or media decoding required.

| File | What it is |
|---|---|
| `notebook-summary.md` | Machine-readable summary: overview, key numbers, both infographics' content, and the slide-deck outline. Start here. |
| `audio-overview.transcript.txt` | Full transcript of the Audio Overview — a journalist↔engineer conversation exploring RuView (CSI sensing, ESP32, vitals, privacy, benchmarks). |
| `video-explainer.transcript.txt` | Full transcript of the Video Overview narration ("See Through Walls with WiFi"). |

The matching human media in `../for-humans/`:
- `video-explainer.mp4` — video explainer
- `audio-overview.mp3` — audio overview (podcast-style)
- `slides-spatial-intelligence.pdf` — 15-slide deck "RuView Spatial Intelligence"
- `infographic-1-process.png`, `infographic-2-seethrough.png` — two infographics

## Provenance
- Built from the **ruvnet/RuView** GitHub repository via Google NotebookLM (Studio).
- Notebook: "RuView: Real-Time WiFi Spatial Intelligence and Vital Monitoring".
- Transcripts produced locally with OpenAI Whisper (`small.en`); minor proper-noun
  mistranscriptions are possible (e.g. "π RuView" → "PiRuView"). Treat as faithful prose,
  not a byte-exact script. The authoritative source remains the RuView repo + the two primers.
