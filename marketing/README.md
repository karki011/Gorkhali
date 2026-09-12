# Gorkhali social kit

Two original motion graphics for Instagram Reels. Each export is exactly
**10 seconds**, **1080 × 1920 (9:16)**, **30 fps**, H.264 MP4 with stereo AAC audio.
They use animated typography and illustrated workflows, not captured product runs.
All key messaging appears on screen; neither reel has voiceover.

| Reel | Download | Cover |
| --- | --- | --- |
| **01 · Code is just the start** | [MP4](reels/01-code-to-reviewed-pr.mp4) | [JPG](reels/01-code-to-reviewed-pr-cover.jpg) |
| **02 · Interrupted? Keep going** | [MP4](reels/02-pick-up-your-work.mp4) | [JPG](reels/02-pick-up-your-work-cover.jpg) |

For GitHub downloads, open the file and use **Download raw file**. Upload the MP4
as a Reel, select its matching cover, and use or adapt the caption below. The copy
stays away from the top and bottom edges and the right-side action controls; check
the crop and caption overlay in Instagram's preview before posting. You can mute
the original audio and add music in Instagram if preferred.

## Reel 01 caption

Code is just the start. Give your next PR a process.

Gorkhali brings approved plans, focused implementation, repository checks, and
independent review to Claude Code. You approve the work. You control the merge.

Try it: github.com/karki011/Gorkhali

#ClaudeCode #DeveloperTools #SoftwareEngineering #OpenSource #Gorkhali

## Reel 02 caption

Interrupted doesn't have to mean starting over.

Gorkhali records progress, reconciles Git when you resume, and marks old
verification stale when the work changes. Pick up the thread of your next build.

Built for Claude Code. Try it: github.com/karki011/Gorkhali

#ClaudeCode #DeveloperWorkflow #CodingTools #OpenSource #Gorkhali

## Edit and render

`render.py` creates both reels, their covers, and the README banner. All visual
geometry and the synthesized audio are authored in that script; no third-party
footage, music samples, or voice recordings are used. System fonts are rasterized
into the exports, not bundled as font files.

Requirements: Python 3 with `Pillow` and `numpy`, plus `ffmpeg` on PATH. The script
uses local Arial fonts on macOS and falls back to DejaVu Sans on Linux. Set
`GORKHALI_FONT_DIR` to a folder containing Arial TTF files to choose that font
installation. Font differences can change typography; inspect the output after
rendering on another host.

```sh
python3 marketing/render.py --stills-only  # Banner and temporary preview frames
python3 marketing/render.py                # Two MP4s and matching covers
```

Rendering makes no provider or network requests. Temporary WAV files are removed
after encoding. Preview/contact sheets go to the system's `/tmp` directory.

The export settings follow the MP4/H.264, AAC 48 kHz, and vertical-format guidance
in [Meta's Instagram API collection](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing).
The kit is prepared for upload; it does not post to an Instagram account.
