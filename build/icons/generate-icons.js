const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Source icon
const sourceIcon = path.join(__dirname, 'icon-clean.svg');

// Windows ICO generation helper
async function generateIco() {
  const sizes = [16, 32, 48, 256];
  const pngBuffers = [];
  
  for (const size of sizes) {
    const buffer = await sharp(sourceIcon)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buffer);
  }
  
  // For now, we'll just create a 256x256 PNG that Windows can use
  // A proper ICO would need a library like png-to-ico
  await sharp(sourceIcon)
    .resize(256, 256)
    .png()
    .toFile(path.join(__dirname, 'icon.ico.png'));
  
  console.log('Created icon.ico.png (rename to icon.ico for Windows)');
}

// macOS ICNS generation helper
async function generateIcns() {
  // Generate required sizes for macOS
  const sizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' }
  ];
  
  const iconsetDir = path.join(__dirname, 'icon.iconset');
  
  // Create iconset directory
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir);
  }
  
  // Generate all required sizes
  for (const { size, name } of sizes) {
    await sharp(sourceIcon)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsetDir, name));
  }
  
  console.log('Created icon.iconset directory with all required sizes');
  console.log('To generate .icns file on macOS, run:');
  console.log('iconutil -c icns icon.iconset');
}

// Generate standard PNG
async function generatePng() {
  await sharp(sourceIcon)
    .resize(256, 256)
    .png()
    .toFile(path.join(__dirname, 'icon.png'));
  console.log('Created icon.png');
}

// Main function
async function generateAllIcons() {
  try {
    console.log('Generating icons from', sourceIcon);
    
    await generatePng();
    await generateIco();
    await generateIcns();
    
    console.log('\nIcon generation complete!');
    console.log('\nNext steps:');
    console.log('1. On Windows: rename icon.ico.png to icon.ico');
    console.log('2. On macOS: run "iconutil -c icns build/icons/icon.iconset"');
    console.log('3. Test the icons in the built application');
  } catch (error) {
    console.error('Error generating icons:', error);
  }
}

generateAllIcons();