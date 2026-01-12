#!/usr/bin/env bash
set -euo pipefail

npm config --location=project set '@fortawesome:registry https://npm.fontawesome.com'
npm config --location=project set '@awesome.me:registry https://npm.fontawesome.com'
npm config --location=project set -- '//npm.fontawesome.com/:_authToken=${FONTAWESOME_TOKEN}'