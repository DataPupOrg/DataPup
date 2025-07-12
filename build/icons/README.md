# DataPup Icons

This directory contains the application icons for DataPup.

## Icon Files

- **icon-clean.svg**: Clean source SVG file with rounded background
- **icon.svg**: Original detailed SVG (for reference)
- **icon.icns**: macOS icon (generated)
- **icon.ico**: Windows icon (generated)
- **icon.png**: Linux icon (256x256 PNG, generated)
- **generate-icons.js**: Script to generate platform-specific icons

## Generating Icons

To regenerate icons from the source:

```bash
# Make sure sharp is installed
npm install sharp

# Run the generation script
node build/icons/generate-icons.js

# On macOS, generate the .icns file
cd build/icons && iconutil -c icns icon.iconset

# Rename Windows icon
mv icon.ico.png icon.ico
```

## Icon Design

The DataPup icon is a paw print on a soft purple background (#aab2ff), representing the playful and friendly nature of the database client. The icon uses:
- Rounded corners (20% border radius) for a modern look
- White paw print on colored background for better visibility
- Consistent sizing across platforms

## Platform Requirements

- **macOS (.icns)**: Multiple sizes from 16x16 to 1024x1024
- **Windows (.ico)**: 16x16, 32x32, 48x48, and 256x256
- **Linux (.png)**: 256x256 PNG