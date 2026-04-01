# Feishu Bridge Light Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight Feishu card rendering for bridge-owned help, doctor, approval, and task lifecycle notices without cardifying ordinary Codex content.

**Architecture:** Keep bridge routing unchanged and add a thin outbound presentation layer that chooses between plain text and static Feishu cards for a small allowlist of bridge-owned messages. Normal Codex content and generic bridge text continue to use plain text.

**Tech Stack:** Node.js, built-in `node:test`, OpenClaw Feishu `sendCardFeishu`, existing `extensions/codex-bridge` locale and reply helpers

---
