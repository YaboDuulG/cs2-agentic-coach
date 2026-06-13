# Agentic Development Guidelines

This document outlines the core principles and best practices for all AI agent-driven development on the DemoSage platform. Whenever a new instruction or feature request is received, refer to these guidelines to ensure consistency, reliability, and high-quality software engineering.

## 1. Plan Before Execution
- **Understand the Goal:** Never start writing code without fully understanding the user's objective. Ask clarifying questions if the requirements are ambiguous.
- **Architectural Review:** For major features (like building the Stratbook competitor), assess the current architecture. Determine how new components (database tables, API routes, frontend views) will integrate without breaking existing functionality.
- **Implementation Plans:** For complex tasks, draft a step-by-step implementation plan (e.g., in `implementation_plan.md`) and get user approval before touching the codebase.

## 2. Principle of Least Privilege & Specific Tooling
- **Specific Tools First:** Always prioritize native, specialized tools over raw bash commands. Use `grep_search` instead of `grep` in the terminal, `view_file` instead of `cat`, and native code editing tools instead of `sed`.
- **Atomic Commits:** When using Git, commit changes logically. If a task involves updating the database schema and adding a new frontend route, make sure the commits are descriptive and atomic.

## 3. Test-Driven & Verified Development
- **Local Verification:** Do not assume code works just because it was written. If building a new API route, ensure unit tests are updated or run a local script to verify its behavior.
- **CI/CD Awareness:** Ensure that any code changes comply with the project's linting (`ruff`), type-checking (`mypy`), and testing pipelines. Before ending a turn after a major push, monitor the CI pipeline to ensure the build stays green.

## 4. State Management & Modularity
- **Avoid Global Side Effects:** When modifying core services (like `parse_demo.py` or `great_khan.py`), encapsulate logic cleanly to prevent side effects in other parts of the application.
- **Asynchronous by Default:** For heavy I/O operations (like LLM API calls or database bulk inserts), default to `asyncio` to maintain high-performance latency standards (e.g., sub-1-minute demo parsing).

## 5. Clear Communication
- **Walkthroughs:** After completing a significant feature, always provide a clear summary of what was changed, how it was tested, and how it impacts the overall system.
- **Visibility:** Highlight any critical design decisions or potential technical debt introduced during rapid prototyping.

---
*Note: As we expand DemoSage into a full-fledged Stratbook competitor, these guidelines will ensure the codebase remains maintainable, scalable, and robust.*
