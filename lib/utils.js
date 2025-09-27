'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Helper function to load JSON from a file. Returns default value if reading fails.
 * @param {string} filePath Absolute file path
 * @param {any} defaultValue Fallback value
 * @returns {any}
 */
function loadJson(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load JSON from ${filePath}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Resolve a path relative to the project root.
 * @param {string} segments
 * @returns {string}
 */
function projectPath(...segments) {
  return path.join(__dirname, '..', ...segments);
}

module.exports = {
  loadJson,
  projectPath,
};
