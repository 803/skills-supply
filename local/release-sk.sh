#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Ensure no staged changes exist
if ! git diff --cached --quiet; then
  echo "Error: staged changes exist. Please commit or unstage them first." >&2
  exit 1
fi

# Run npm version in packages/sk (updates package.json, no git tag)
cd packages/sk
npm version "$@" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
cd ../..

# Commit and tag with scoped format
git add packages/sk/package.json package-lock.json
git commit -m "sk: release $VERSION"
git tag "sk@$VERSION"

echo ""
echo "Pushing sk@$VERSION..."
git push && git push --tags
