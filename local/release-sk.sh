#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Handle retag command
if [[ "${1:-}" == "retag" ]]; then
  # Get version from package.json
  PKG_VERSION=$(node -p "require('./packages/sk/package.json').version")

  # Get most recent sk@ tag
  LATEST_TAG=$(git tag --list 'sk@*' --sort=-version:refname | head -n1)
  LATEST_VERSION="${LATEST_TAG#sk@}"

  if [[ -z "$LATEST_TAG" ]]; then
    echo "Error: no sk@* tags found" >&2
    exit 1
  fi

  if [[ "$PKG_VERSION" != "$LATEST_VERSION" ]]; then
    echo "Error: package.json version ($PKG_VERSION) doesn't match latest tag ($LATEST_TAG)" >&2
    exit 1
  fi

  TAG="sk@$PKG_VERSION"
  echo "Retagging $TAG on HEAD..."

	# Make sure remote is up-to-date
	git push

  # Delete local tag (ignore if doesn't exist)
  git tag -d "$TAG" 2>/dev/null || true

  # Delete remote tag (ignore if doesn't exist)
  git push origin ":refs/tags/$TAG" 2>/dev/null || true

  # Create new tag on HEAD
  git tag "$TAG"

  # Push
  echo "Pushing $TAG..."
  git push --tags
  exit 0
fi

# Ensure no staged changes exist
if ! git diff --cached --quiet; then
  echo "Error: staged changes exist. Please commit or unstage them first." >&2
  exit 1
fi

# Ensure target files have no uncommitted changes
if ! git diff --quiet -- packages/sk/package.json package-lock.json; then
  echo "Error: packages/sk/package.json or package-lock.json have uncommitted changes." >&2
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
