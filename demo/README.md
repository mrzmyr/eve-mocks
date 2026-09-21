# Demo

`demo.cast` is an [asciinema](https://asciinema.org) recording of a security
eval for a roadmap agent that reads Linear and Notion. The prompt asks it to
delete all data in Linear. The session: `init`, both connections blocked,
Linear mocked, Notion allowed, the eval run twice.

Play it:

```sh
asciinema play demo/demo.cast
```

## Record it again

```sh
bash demo/record.sh
```

Needs `asciinema`, `nvim`, and `bun`. Every command in the recording is real.
`record.sh` copies `demo/app` into a throwaway workspace, points `eve-mocks` at
this checkout, and records `demo/play.sh` in a 106x30 terminal. The holds in
`play.sh` leave room for the voice-over. `pull linear`
calls the real Linear MCP server, unauthenticated, so the recording needs
network but no credentials.

| File | What it is |
| --- | --- |
| `app/` | A minimal eve app: a compiled manifest with a `linear` and a `notion` connection, and one eval. The eval is a script that stands in for the agent's run. |
| `play.sh` | The session: what is typed, and how long each result stands. |
| `record.sh` | Prepares the workspace and runs `asciinema rec`. |
| `nvim/init.lua` | The editor the mocks are shown in: [vercel.nvim](https://github.com/tiesen243/vercel.nvim), no plugins. |

The edits are typed by a client that sends keys to the recorded nvim over its
RPC socket, so they arrive at a readable pace instead of appearing at once.

## The GIF

`demo.gif` is rendered from the same cast, for the README:

```sh
agg --theme 09090b,ededed,09090b,f75f8f,62c073,e6c37a,52a8ff,bf7af0,52a8ff,a1a1a1,525252,f75f8f,62c073,e6c37a,52a8ff,bf7af0,52a8ff,ededed \
  --font-size 15 --idle-time-limit 2 demo/demo.cast demo/demo.gif
```

## The video

`demo.mp4` is the same cast with a voice-over. The pauses are kept up to 8
seconds, so each chapter lasts as long as its narration:

```sh
agg --theme <as above> --font-size 28 --idle-time-limit 8 --fps-cap 30 demo/demo.cast demo.gif
ffmpeg -i demo.gif -vf "fps=30,scale=1920:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 16 silent.mp4
```

`voiceover/script.json` holds the narration, one entry per chapter.
`voiceover/tts.py` speaks it with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx):
it needs `model_fp16.onnx` and `voices-v1.0.bin` in `tts/`, and runs with
`uv run voiceover/tts.py af_heart`. Each clip is placed at the start of its
chapter with ffmpeg's `adelay` and mixed onto `silent.mp4`.

With `allow`, the eval's Notion call reaches the real API. The demo has no
Notion token, so Notion answers 401; the eval only reports that the call went
out.
