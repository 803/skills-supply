#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Run npm version in packages/sk (updates package.json, no git tag)
cd packages/sk
npm version "$@" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
cd ../..

# Commit and tag with scoped format
git add .
git commit -m "sk: release $VERSION"
git tag "sk@$VERSION"

echo ""
echo "Created tag sk@$VERSION"
echo "Run: git push && git push --tags"
