#!/bin/sh
# Builds android/app/build/outputs/apk/release/app-release.apk from www/ (+ twemoji in android assets).
# Before building a new APK: raise versionCode in android/app/build.gradle, and set
# BUILTIN_WWW_CODE / BUILTIN_WWW_VERSION in Updater.java to the code/version of the bundle you publish with it.
set -e
cd "$(dirname "$0")"
A=android/app/src/main/assets/www
find "$A" -maxdepth 1 -type f -delete
cp www/*.js www/*.html www/*.css "$A"/
cd android && gradle assembleRelease --no-daemon -q
