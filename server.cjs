const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3001;

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://chipper-pegasus-bb68b0.netlify.app',
    'https://convertz.app',
    'https://www.convertz.app'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadsDir);

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// Enhanced capability checking
const checkCapabilities = async () => {
  const capabilities = {
    sharp: true, // Sharp is always available if installed
    ffmpeg: false,
    libreoffice: false
  };

  // Check FFmpeg
  try {
    await new Promise((resolve, reject) => {
      exec('ffmpeg -version', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    capabilities.ffmpeg = true;
  } catch (error) {
    console.log('FFmpeg not available:', error.message);
  }

  // Check LibreOffice with enhanced detection
  try {
    await new Promise((resolve, reject) => {
      exec('libreoffice --headless --version', (error, stdout) => {
        if (error) {
          // Try alternative command
          exec('soffice --headless --version', (error2, stdout2) => {
            if (error2) reject(error2);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    });
    capabilities.libreoffice = true;
  } catch (error) {
    console.log('LibreOffice not available:', error.message);
  }

  return capabilities;
};

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const capabilities = await checkCapabilities();
    res.json({
      status: 'online',
      capabilities,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Get capabilities endpoint
app.get('/api/capabilities', async (req, res) => {
  try {
    const capabilities = await checkCapabilities();
    res.json(capabilities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enhanced LibreOffice conversion function
const convertWithLibreOffice = (inputPath, outputDir, outputFormat) => {
  return new Promise((resolve, reject) => {
    // Create a unique temp directory for this conversion
    const tempDir = path.join(__dirname, 'temp', uuidv4());
    fs.ensureDirSync(tempDir);

    // Copy input file to temp directory
    const tempInputPath = path.join(tempDir, path.basename(inputPath));
    fs.copyFileSync(inputPath, tempInputPath);

    // Enhanced LibreOffice command with better error handling
    const command = `libreoffice --headless --convert-to ${outputFormat} --outdir "${outputDir}" "${tempInputPath}"`;
    
    console.log('LibreOffice command:', command);
    
    exec(command, {
      timeout: 30000, // 30 second timeout
      env: {
        ...process.env,
        HOME: '/tmp',
        TMPDIR: '/tmp'
      }
    }, (error, stdout, stderr) => {
      // Clean up temp directory
      fs.removeSync(tempDir);
      
      if (error) {
        console.error('LibreOffice error:', error);
        console.error('LibreOffice stderr:', stderr);
        reject(new Error(`LibreOffice conversion failed: ${error.message}`));
        return;
      }

      console.log('LibreOffice stdout:', stdout);
      console.log('LibreOffice stderr:', stderr);

      // Find the output file
      const baseNameWithoutExt = path.parse(path.basename(inputPath)).name;
      const expectedOutputPath = path.join(outputDir, `${baseNameWithoutExt}.${outputFormat}`);
      
      if (fs.existsSync(expectedOutputPath)) {
        resolve(expectedOutputPath);
      } else {
        // Try to find any file in the output directory
        const files = fs.readdirSync(outputDir);
        const outputFile = files.find(file => file.startsWith(baseNameWithoutExt));
        
        if (outputFile) {
          resolve(path.join(outputDir, outputFile));
        } else {
          reject(new Error('LibreOffice conversion completed but output file not found'));
        }
      }
    });
  });
};

// File conversion endpoint
app.post('/api/convert', upload.single('file'), async (req, res) => {
  let tempFiles = [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, path: filePath, mimetype } = req.file;
    const { outputFormat } = req.body;

    if (!outputFormat) {
      return res.status(400).json({ error: 'Output format not specified' });
    }

    console.log(`Converting ${originalname} (${mimetype}) to ${outputFormat}`);

    tempFiles.push(filePath);

    const inputExt = path.extname(originalname).toLowerCase().slice(1);
    const outputFileName = `${path.parse(originalname).name}.${outputFormat}`;
    const outputPath = path.join(uploadsDir, `converted_${Date.now()}_${outputFileName}`);

    tempFiles.push(outputPath);

    // Image conversion with Sharp
    if (['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp'].includes(inputExt) && 
        ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp'].includes(outputFormat)) {
      
      let sharpInstance = sharp(filePath);
      
      if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality: 90 });
      } else if (outputFormat === 'png') {
        sharpInstance = sharpInstance.png({ compressionLevel: 6 });
      } else if (outputFormat === 'webp') {
        sharpInstance = sharpInstance.webp({ quality: 90 });
      }
      
      await sharpInstance.toFile(outputPath);
    }
    // Audio/Video conversion with FFmpeg
    else if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(inputExt)) {
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }
    // Document conversion with LibreOffice
    else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt'].includes(inputExt)) {
      await convertWithLibreOffice(filePath, uploadsDir, outputFormat);
      
      // Update output path to match LibreOffice naming
      const baseNameWithoutExt = path.parse(originalname).name;
      const libreOfficeOutputPath = path.join(uploadsDir, `${baseNameWithoutExt}.${outputFormat}`);
      
      if (fs.existsSync(libreOfficeOutputPath)) {
        // Move to our expected output path
        fs.moveSync(libreOfficeOutputPath, outputPath);
      } else {
        throw new Error('LibreOffice conversion failed - output file not found');
      }
    }
    else {
      throw new Error(`Unsupported conversion: ${inputExt} to ${outputFormat}`);
    }

    // Check if conversion was successful
    if (!fs.existsSync(outputPath)) {
      throw new Error('Conversion completed but output file not found');
    }

    // Send the converted file
    res.download(outputPath, outputFileName, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up temporary files
      tempFiles.forEach(file => {
        try {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
          }
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
      });
    });

  } catch (error) {
    console.error('Conversion error:', error);
    
    // Clean up temporary files on error
    tempFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    });

    res.status(500).json({ 
      error: 'Conversion failed', 
      details: error.message 
    });
  }
});

// Get supported formats endpoint
app.get('/api/formats/:inputFormat', async (req, res) => {
  const { inputFormat } = req.params;
  const capabilities = await checkCapabilities();
  
  const formatMap = {
    // Image formats (Sharp)
    jpg: ['png', 'webp', 'tiff', 'bmp', 'jpeg'],
    jpeg: ['png', 'webp', 'tiff', 'bmp', 'jpg'],
    png: ['jpg', 'jpeg', 'webp', 'tiff', 'bmp'],
    webp: ['jpg', 'jpeg', 'png', 'tiff', 'bmp'],
    tiff: ['jpg', 'jpeg', 'png', 'webp', 'bmp'],
    bmp: ['jpg', 'jpeg', 'png', 'webp', 'tiff'],
    
    // Video formats (FFmpeg)
    mp4: capabilities.ffmpeg ? ['avi', 'mov', 'wmv', 'flv'] : [],
    avi: capabilities.ffmpeg ? ['mp4', 'mov', 'wmv', 'flv'] : [],
    mov: capabilities.ffmpeg ? ['mp4', 'avi', 'wmv', 'flv'] : [],
    wmv: capabilities.ffmpeg ? ['mp4', 'avi', 'mov', 'flv'] : [],
    flv: capabilities.ffmpeg ? ['mp4', 'avi', 'mov', 'wmv'] : [],
    
    // Audio formats (FFmpeg)
    mp3: capabilities.ffmpeg ? ['wav', 'ogg', 'aac', 'm4a'] : [],
    wav: capabilities.ffmpeg ? ['mp3', 'ogg', 'aac', 'm4a'] : [],
    ogg: capabilities.ffmpeg ? ['mp3', 'wav', 'aac', 'm4a'] : [],
    aac: capabilities.ffmpeg ? ['mp3', 'wav', 'ogg', 'm4a'] : [],
    m4a: capabilities.ffmpeg ? ['mp3', 'wav', 'ogg', 'aac'] : [],
    
    // Document formats (LibreOffice)
    pdf: capabilities.libreoffice ? ['docx', 'odt', 'txt', 'rtf'] : [],
    doc: capabilities.libreoffice ? ['pdf', 'docx', 'odt', 'txt', 'rtf'] : [],
    docx: capabilities.libreoffice ? ['pdf', 'doc', 'odt', 'txt', 'rtf'] : [],
    xls: capabilities.libreoffice ? ['xlsx', 'ods', 'csv'] : [],
    xlsx: capabilities.libreoffice ? ['xls', 'ods', 'csv'] : [],
    ppt: capabilities.libreoffice ? ['pptx', 'odp', 'pdf'] : [],
    pptx: capabilities.libreoffice ? ['ppt', 'odp', 'pdf'] : [],
    odt: capabilities.libreoffice ? ['pdf', 'doc', 'docx', 'txt', 'rtf'] : [],
    ods: capabilities.libreoffice ? ['xls', 'xlsx', 'csv'] : [],
    odp: capabilities.libreoffice ? ['ppt', 'pptx', 'pdf'] : [],
    rtf: capabilities.libreoffice ? ['pdf', 'doc', 'docx', 'odt', 'txt'] : [],
    txt: capabilities.libreoffice ? ['pdf', 'doc', 'docx', 'odt', 'rtf'] : []
  };

  const supportedFormats = formatMap[inputFormat.toLowerCase()] || [];
  res.json({ formats: supportedFormats });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Convertz.app File Conversion API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      capabilities: '/api/capabilities',
      convert: '/api/convert (POST)',
      formats: '/api/formats/:inputFormat'
    }
  });
});

app.listen(port, () => {
  console.log(`🚀 Convertz.app API running on port ${port}`);
  console.log(`📊 Health check: http://localhost:${port}/api/health`);
  
  // Check capabilities on startup
  checkCapabilities().then(capabilities => {
    console.log('📋 Available capabilities:', capabilities);
  });
});
