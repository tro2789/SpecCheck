# Spec Check

register: product

## Product purpose

A Premiere Pro CEP panel that answers one question at a glance: does this
mix pass the delivery spec? It measures rendered audio (LUFS, true peak,
RMS, noise floor, silence, format) and scores it against a chosen preset
(ACX/Audible, Apple Podcasts, Spotify, EBU R128, YouTube, custom).

## Users

Podcast and audio editors working inside Adobe Premiere Pro, usually in a
dim edit suite with the panel docked beside a dark timeline. They are
mid-task; the panel is glanced at, not lived in. Fluent reference points:
Premiere's own panels, iZotope RX, Youlean Loudness Meter.

## Tone

Calm instrument, not dashboard. The panel should read like it shipped with
Premiere: native control vocabulary, dense but quiet, zero decoration.
Verdicts are the only loud thing on the surface, and only when they fail.

## Strategic principles

- The tool disappears into the host. It adopts Premiere's skin (via CEP
  appSkinInfo) rather than imposing a brand.
- Pass/fail is readable from across the room; everything else is readable
  up close.
- Measured values are facts: mono-spaced, never decorated.
- Family resemblance with Sequence Batch Exporter (same author, same
  install base) without copying its layout.

## Anti-references

- Web-app SaaS dashboards (cards, shadows, gradients, hero metrics).
- Consumer audio skeuomorphism (knobs, brushed metal, LED textures).
- Full-grid HTML tables with borders on every cell.
