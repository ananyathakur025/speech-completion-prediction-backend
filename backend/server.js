const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 200
}));

app.options('/predict', cors());
app.use(bodyParser.json());

app.post('/predict', async (req, res) => {
  console.log("🛎️ Received request at /predict");

  const transcript = req.body.transcript;
  console.log("Transcript received:", transcript);

  if (!transcript) {
    return res.status(400).json({ error: "Transcript is required" });
  }

  // Try debug script first, then fallback to original
  const debugScriptPath = path.join(__dirname, '..', 'scripts', 'debug_predict.py');
  const originalScriptPath = path.join(__dirname, '..', 'scripts', 'predict.py');
  
  // Use debug script if it exists, otherwise use original
  const scriptPath = require('fs').existsSync(debugScriptPath) ? debugScriptPath : originalScriptPath;
  
  console.log("📁 Using script path:", scriptPath);
  console.log("📁 Script exists:", require('fs').existsSync(scriptPath));

  // Try different Python commands
  const pythonCommands = ['python3', 'python', 'py'];
  
  for (const pythonCmd of pythonCommands) {
    console.log(`🐍 Trying Python command: ${pythonCmd}`);
    
    try {
      const python = spawn(pythonCmd, [scriptPath]);
      
      python.stdin.write(JSON.stringify({ transcript }));
      python.stdin.end();

      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });

      python.stderr.on('data', (err) => {
        errorOutput += err.toString();
        console.error(`❌ Python stderr (${pythonCmd}):`, err.toString());
      });

      python.on('close', (code) => {
        console.log(`🔚 Python process (${pythonCmd}) exited with code`, code);
        
        if (code !== 0) {
          console.error(`❌ Python script failed with code: ${code}`);
          console.error(`❌ Error output: ${errorOutput}`);
          
          // If this isn't the last command to try, continue to next
          if (pythonCmd !== pythonCommands[pythonCommands.length - 1]) {
            return;
          }
          
          return res.status(500).json({ 
            error: "Python script error", 
            details: errorOutput,
            code: code,
            pythonCommand: pythonCmd,
            scriptPath: scriptPath
          });
        }

        if (!output.trim()) {
          console.error("❗ No output from Python script");
          return res.status(500).json({ 
            error: "No output from Python script",
            stderr: errorOutput,
            pythonCommand: pythonCmd
          });
        }

        try {
          const result = JSON.parse(output);
          console.log("✅ Result sent to frontend:", result);
          res.json({ 
            prediction: result.prediction,
            debug_info: result.debug_info,
            pythonCommand: pythonCmd
          });
          return; // Success, exit the loop
        } catch (err) {
          console.error("❗ Failed to parse Python output:", output);
          console.error("❗ Parse error:", err.message);
          res.status(500).json({ 
            error: "Invalid Python response", 
            output: output,
            stderr: errorOutput,
            pythonCommand: pythonCmd
          });
          return;
        }
      });

      python.on('error', (err) => {
        console.error(`❌ Failed to start Python process (${pythonCmd}):`, err);
        
        // If this isn't the last command to try, continue to next
        if (pythonCmd !== pythonCommands[pythonCommands.length - 1]) {
          return;
        }
        
        res.status(500).json({ 
          error: "Failed to start Python process", 
          details: err.message,
          pythonCommand: pythonCmd
        });
      });

      // If we get here, the process started successfully, so break the loop
      break;
      
    } catch (err) {
      console.error(`❌ Error with Python command ${pythonCmd}:`, err);
      continue;
    }
  }
});

// Enhanced test endpoint
app.get('/test', (req, res) => {
  const debugInfo = {
    message: "Backend is working!",
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    scriptPath: path.join(__dirname, '..', 'scripts', 'predict.py'),
    debugScriptPath: path.join(__dirname, '..', 'scripts', 'debug_predict.py'),
    scriptsExist: {
      original: require('fs').existsSync(path.join(__dirname, '..', 'scripts', 'predict.py')),
      debug: require('fs').existsSync(path.join(__dirname, '..', 'scripts', 'debug_predict.py'))
    }
  };
  
  res.json(debugInfo);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});