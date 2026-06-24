#!/bin/bash
export PATH="/usr/local/bin:$PATH"
cd "$(dirname "$0")"
npm run dev --workspace=frontend
