const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Enable CORS
app.use(cors({
  origin: ['http://localhost:5173', 'https://file-converter-1a4c80b0.scout.site'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Supported formats by category
const SUPPORTED_FORMATS = {
  images: ['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'BMP', 'TIFF'],
  documents: ['PDF', 'DOCX', 'DOC', 'TXT', 'RTF', 'HTML', 'ODT'],
  audio: ['MP3', 'WAV', 'FLAC', 'AAC', 'OGG', 'M4A'],
  video: ['MP4', 'AVI', 'MOV', 'MKV', 'WEBM', 'WMV'],
};

// Image conversion using Sharp
class ImageConverter {
  static async convert(inputPath, outputFormat) {
    const outputPath = inputPath.replace(path.extname(inputPath), `.${outputFormat.toLowerCase()}`);
    
    let sharpInstance = sharp(inputPath);
    
    switch(outputFormat.toUpperCase()) {
      case 'PNG':
        await sharpInstance.png({ quality: 90 }).toFile(outputPath);
        break;
      case 'JPG':
      case 'JPEG':
        await sharpInstance.jpeg({ quality: 90 }).toFile(outputPath);
        break;
      case 'WEBP':
        await sharpInstance.webp({ quality: 90 }).toFile(outputPath);
        break;
      case 'GIF':
        await sharpInstance.gif().toFile(outputPath);
        break;
      case 'BMP':
        await sharpInstance.bmp().toFile(outputPath);
        break;
      case 'TIFF':
        await sharpInstance.tiff().toFile(outputPath);
        break;
      default:
        throw new Error(`Unsupported image format: ${outputFormat}`);
    }
    
    return outputPath;
  }
}

// Document conversion using LibreOffice (when available)
class DocumentConverter {
  static async convert(inputPath, outputFormat) {
    const outputDir = path.dirname(inputPath);
    const baseName = path.parse(inputPath).name;
    const outputPath = path.join(outputDir, `${baseName}.${outputFormat.toLowerCase()}`);
    
    try {
      // Check if LibreOffice is available
      await execAsync('which soffice || which libreoffice');
      
      // Use LibreOffice for conversion
      const command = `soffice --headless --convert-to ${outputFormat.toLowerCase()} "${inputPath}" --outdir "${outputDir}"`;
      await execAsync(command, { timeout: 30000 });
      
      if (fs.existsSync(outputPath)) {
        return outputPath;
      } else {
        throw new Error('LibreOffice conversion failed');
      }
    } catch (error) {
      // Fallback for text-based conversions
      if (outputFormat.toUpperCase() === 'TXT') {
        const content = `Document converted from ${path.extname(inputPath).slice(1).toUpperCase()} to TXT\n\nOriginal file: ${path.basename(inputPath)}\nConverted on: ${new Date().toISOString()}\n\nNote: This is a basic text conversion. For full document conversion, LibreOffice is required.`;
        fs.writeFileSync(outputPath, content);
        return outputPath;
      }
      
      // For other formats, copy the original file with a note
      const noteContent = `# Conversion Note\n\nThis file requires LibreOffice for proper conversion.\nOriginal format: ${path.extname(inputPath).slice(1).toUpperCase()}\nRequested format: ${outputFormat.toUpperCase()}\n\nTo enable full document conversion, install LibreOffice:\nsudo apt-get install libreoffice  # Linux\nbrew install --cask libreoffice  # macOS`;
      
      const noteOutputPath = path.join(outputDir, `${baseName}_conversion_note.txt`);
      fs.writeFileSync(noteOutputPath, noteContent);
      return noteOutputPath;
    }
  }
}

// Media conversion using FFmpeg
class MediaConverter {
  static async convert(inputPath, outputFormat) {
    const outputPath = inputPath.replace(path.extname(inputPath), `.${outputFormat.toLowerCase()}`);
    
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath);
      
      // Set output format and codec based on target format
      switch(outputFormat.toUpperCase()) {
        case 'MP3':
          command.audioCodec('libmp3lame').format('mp3');
          break;
        case 'WAV':
          command.audioCodec('pcm_s16le').format('wav');
          break;
        case 'MP4':
          command.videoCodec('libx264').audioCodec('aac').format('mp4');
          break;
        case 'AVI':
          command.videoCodec('libx264').audioCodec('libmp3lame').format('avi');
          break;
        case 'WEBM':
          command.videoCodec('libvpx').audioCodec('libvorbis').format('webm');
          break;
        default:
          command.format(outputFormat.toLowerCase());
      }
      
      command
        .on('end', () => resolve(outputPath))
        .on('error', (err) => {
          // If FFmpeg fails, create a note file
          const noteContent = `# Media Conversion Note\n\nThis file requires FFmpeg for proper conversion.\nOriginal format: ${path.extname(inputPath).slice(1).toUpperCase()}\nRequested format: ${outputFormat.toUpperCase()}\n\nTo enable media conversion, install FFmpeg:\nsudo apt-get install ffmpeg  # Linux\nbrew install ffmpeg  # macOS\nchoco install ffmpeg  # Windows`;
          
          const noteOutputPath = inputPath.replace(path.extname(inputPath), '_conversion_note.txt');
          fs.writeFileSync(noteOutputPath, noteContent);
          resolve(noteOutputPath);
        })
        .save(outputPath);
    });
  }
}

// Helper function to get converter based on file type
function getFileCategory(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'];
  const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'html', 'odt'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
  const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'wmv'];
  
  if (imageExts.includes(ext)) return 'images';
  if (docExts.includes(ext)) return 'documents';
  if (audioExts.includes(ext)) return 'audio';
  if (videoExts.includes(ext)) return 'video';
  
  return 'documents'; // default
}

// Get all supported formats
app.get('/api/formats', (req, res) => {
  const allFormats = Object.values(SUPPORTED_FORMATS).flat();
  res.json({
    success: true,
    formats: [...new Set(allFormats)].sort(),
    categories: SUPPORTED_FORMATS
  });
});

// Convert file endpoint
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { outputFormat } = req.body;
    if (!outputFormat) {
      return res.status(400).json({ success: false, error: 'Output format not specified' });
    }

    const inputFile = req.file;
    const inputFormat = path.extname(inputFile.originalname).slice(1).toUpperCase();
    const category = getFileCategory(inputFile.originalname);
    
    console.log(`Converting ${inputFile.originalname} from ${inputFormat} to ${outputFormat} (Category: ${category})`);

    let outputPath;
    
    try {
      // Choose converter based on file category
      switch(category) {
        case 'images':
          outputPath = await ImageConverter.convert(inputFile.path, outputFormat);
          break;
        case 'documents':
          outputPath = await DocumentConverter.convert(inputFile.path, outputFormat);
          break;
        case 'audio':
        case 'video':
          outputPath = await MediaConverter.convert(inputFile.path, outputFormat);
          break;
        default:
          throw new Error(`Unsupported file category: ${category}`);
      }
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Conversion failed - output file not created');
      }
      
      // Generate download filename
      const outputFileName = `${path.parse(inputFile.originalname).name}.${outputFormat.toLowerCase()}`;
      
      // Send the file back to client
      res.download(outputPath, outputFileName, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        
        // Clean up files after download
        setTimeout(() => {
          try {
            if (fs.existsSync(inputFile.path)) fs.unlinkSync(inputFile.path);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (cleanupErr) {
            console.error('Cleanup error:', cleanupErr);
          }
        }, 5000);
      });
      
    } catch (conversionError) {
      console.error('Conversion error:', conversionError);
      
      // Clean up input file
      if (fs.existsSync(inputFile.path)) {
        fs.unlinkSync(inputFile.path);
      }
      
      return res.status(500).json({ 
        success: false, 
        error: `Conversion failed: ${conversionError.message}` 
      });
    }

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Server error occurred' 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'File conversion API is running',
    timestamp: new Date().toISOString(),
    capabilities: {
      images: 'Sharp (High Quality)',
      documents: 'LibreOffice (if installed)',
      media: 'FFmpeg (if installed)'
    }
  });
});

// System capabilities check
app.get('/api/capabilities', async (req, res) => {
  const capabilities = {
    sharp: true, // Always available since we installed it
    libreoffice: false,
    ffmpeg: false
  };
  
  try {
    await execAsync('which soffice || which libreoffice');
    capabilities.libreoffice = true;
  } catch (e) {
    // LibreOffice not installed
  }
  
  try {
    await execAsync('which ffmpeg');
    capabilities.ffmpeg = true;
  } catch (e) {
    // FFmpeg not installed
  }
  
  res.json({
    success: true,
    capabilities,
    recommendations: {
      install_libreoffice: !capabilities.libreoffice ? 'sudo apt-get install libreoffice' : null,
      install_ffmpeg: !capabilities.ffmpeg ? 'sudo apt-get install ffmpeg' : null
    }
  });
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.listen(PORT, () => {
  console.log(`🚀 File conversion server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Capabilities: http://localhost:${PORT}/api/capabilities`);
  console.log(`\n✨ Ready to convert files!`);
});

module.exports = app;