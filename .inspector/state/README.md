# Durable State Directory

This directory contains committed **schemas, policies, and examples only**.

Runtime databases, checkpoints, traces, screenshots, videos, model transcripts, worktrees, and other run artifacts must stay out of Git and are ignored by `.gitignore`.

The implementation should default runtime state to a project-local ignored directory such as `.inspector/runs/` with an option to place it elsewhere.
