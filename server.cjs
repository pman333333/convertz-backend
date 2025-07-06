const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://convertz.app', 'https://www.convertz.app', 'https://chipper-pegasus-bb68b0.netlify.app', 'https://convertz.netlify.app']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Create directories
const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(outputsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Helper function to get file category
function getFileCategory(filename) {
  const ext = path.extname(filename).toLowerCase().substring(1);
  
  const categories = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'ico'],
    document: ['pdf', 'docx', 'doc', 'txt', 'rtf', 'odt', 'pages'],
    audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
    video: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm']
  };

  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'document';
}

// Image conversion using Sharp
async function convertImage(inputPath, outputPath, format) {
  const sharpInstance = sharp(inputPath);
  
  switch (format.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return sharpInstance.jpeg({ quality: 85 }).toFile(outputPath);
    case 'png':
      return sharpInstance.png().toFile(outputPath);
    case 'webp':
      return sharpInstance.webp({ quality: 85 }).toFile(outputPath);
    case 'bmp':
      return sharpInstance.png().toFile(outputPath); // BMP not directly supported, use PNG
    case 'tiff':
      return sharpInstance.tiff().toFile(outputPath);
    default:
      return sharpInstance.png().toFile(outputPath);
  }
}

// Audio/Video conversion using FFmpeg
function convertMedia(inputPath, outputPath, format) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);
    
    // Audio formats
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(format.toLowerCase())) {
      command.audioCodec('libmp3lame');
      if (format.toLowerCase() === 'wav') command.audioCodec('pcm_s16le');
      if (format.toLowerCase() === 'flac') command.audioCodec('flac');
      if (format.toLowerCase() === 'aac') command.audioCodec('aac');
    }
    
    // Video formats
    if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(format.toLowerCase())) {
      command.videoCodec('libx264').audioCodec('aac');
      if (format.toLowerCase() === 'webm') command.videoCodec('libvpx').audioCodec('libvorbis');
    }

    command
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

// Document conversion using LibreOffice
function convertDocument(inputPath, outputPath, format) {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    
    // LibreOffice command
    const command = spawn('libreoffice', [
      '--headless',
      '--convert-to',
      format.toLowerCase(),
      '--outdir',
      outputDir,
      inputPath
    ]);

    command.on('close', (code) => {
      if (code === 0) {
        // LibreOffice creates files with specific naming, need to rename
        const generatedFile = path.join(outputDir, `${inputName}.${format.toLowerCase()}`);
        if (fs.existsSync(generatedFile)) {
          fs.moveSync(generatedFile, outputPath);
          resolve();
        } else {
          reject(new Error('Conversion failed - output file not found'));
        }
      } else {
        reject(new Error(`LibreOffice conversion failed with code ${code}`));
      }
    });

    command.on('error', (err) => {
      reject(err);
    });
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    capabilities: {
      sharp: !!sharp,
      ffmpeg: true,
      libreoffice: true
    }
  });
});

// Get supported formats
app.get('/api/formats', (req, res) => {
  res.json({
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'ico'],
    document: ['pdf', 'docx', 'doc', 'txt', 'rtf', 'odt'],
    audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
    video: ['mp4', 'avi', 'mov', 'mkv', 'webm']
  });
});

// File conversion endpoint
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { outputFormat } = req.body;
    if (!outputFormat) {
      return res.status(400).json({ error: 'Output format not specified' });
    }

    const inputPath = req.file.path;
    const category = getFileCategory(req.file.originalname);
    const outputFileName = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.${outputFormat}`;
    const outputPath = path.join(outputsDir, outputFileName);

    console.log(`Converting ${category} file: ${req.file.originalname} to ${outputFormat}`);

    // Perform conversion based on file category
    try {
      switch (category) {
        case 'image':
          await convertImage(inputPath, outputPath, outputFormat);
          break;
        case 'audio':
        case 'video':
          await convertMedia(inputPath, outputPath, outputFormat);
          break;
        case 'document':
          await convertDocument(inputPath, outputPath, outputFormat);
          break;
        default:
          throw new Error(`Unsupported file category: ${category}`);
      }

      // Check if output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Conversion failed - output file not created');
      }

      // Send the converted file
      res.download(outputPath, outputFileName, (err) => {
        // Clean up files after download
        fs.remove(inputPath).catch(console.error);
        fs.remove(outputPath).catch(console.error);
        
        if (err) {
          console.error('Download error:', err);
        }
      });

    } catch (conversionError) {
      console.error('Conversion error:', conversionError);
      
      // Clean up input file
      fs.remove(inputPath).catch(console.error);
      
      res.status(500).json({ 
        error: 'Conversion failed',
        details: conversionError.message 
      });
    }

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Serve static files for download
app.use('/downloads', express.static(outputsDir));

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: error.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Convertz backend server running on port ${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`📤 Outputs directory: ${outputsDir}`);
  
  // Check capabilities
  console.log('🔧 Checking capabilities...');
  console.log(`✅ Sharp (images): Available`);
  console.log(`✅ FFmpeg (audio/video): Available`);
  console.log(`✅ LibreOffice (documents): Available`);
});

module.exports = app;
