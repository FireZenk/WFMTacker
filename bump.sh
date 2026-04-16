#!/usr/bin/env bash
# Usage: ./bump.sh [patch|minor|major]
# Default: patch

set -e

TYPE=${1:-patch}

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required (brew install jq)" >&2
  exit 1
fi

CURRENT=$(jq -r '.version' manifest.json)
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case $TYPE in
  major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR+1)); PATCH=0 ;;
  patch) PATCH=$((PATCH+1)) ;;
  *)
    echo "Usage: $0 [patch|minor|major]" >&2
    exit 1
    ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"

jq ".version = \"$NEW\"" manifest.json > manifest.tmp.json && mv manifest.tmp.json manifest.json

echo "Bumped $CURRENT → $NEW"

git add manifest.json
git commit -m "chore: bump version to $NEW"
git tag "v$NEW"

echo ""
echo "Done. To release:"
echo "  git push && git push --tags"
