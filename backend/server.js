const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
}));

app.use(bodyParser.json());

app.post('/predict', async (req, res) => {
  console.log("🛎️ Received request at /predict");

  const transcript = req.body.transcript;
  console.log("Transcript received:", transcript);

  if (!transcript) {
    return res.status(400).json({ error: "Transcript is required" });
  }

  // ✅ Updated paths — predict.py now lives in same folder as server.js
  const debugScriptPath = path.join(__dirname, 'debug_predict.py');
  const originalScriptPath = path.join(__dirname, 'predict.py');
  const scriptPath = fs.existsSync(debugScriptPath) ? debugScriptPath : originalScriptPath;

  console.log("📁 Using script path:", scriptPath);
  console.log("📁 Script exists:", fs.existsSync(scriptPath));

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
          if (pythonCmd !== pythonCommands[pythonCommands.length - 1]) return;
          return res.status(500).json({
            error: "Python script error",
            details: errorOutput,
            code,
            pythonCommand: pythonCmd,
            scriptPath
          });
        }

        if (!output.trim()) {
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
          return;
        } catch (err) {
          return res.status(500).json({
            error: "Invalid Python response",
            output,
            stderr: errorOutput,
            pythonCommand: pythonCmd
          });
        }
      });

      python.on('error', (err) => {
        console.error(`❌ Failed to start Python process (${pythonCmd}):`, err);
        if (pythonCmd !== pythonCommands[pythonCommands.length - 1]) return;

        res.status(500).json({
          error: "Failed to start Python process",
          details: err.message,
          pythonCommand: pythonCmd
        });
      });

      break;
    } catch (err) {
      console.error(`❌ Error with Python command ${pythonCmd}:`, err);
      continue;
    }
  }
});

// ✅ Updated paths in /test too
app.get('/test', (req, res) => {
  const debugInfo = {
    message: "Backend is working!",
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    scriptPath: path.join(__dirname, 'predict.py'),
    debugScriptPath: path.join(__dirname, 'debug_predict.py'),
    scriptsExist: {
      original: fs.existsSync(path.join(__dirname, 'predict.py')),
      debug: fs.existsSync(path.join(__dirname, 'debug_predict.py'))
    }
  };

  res.json(debugInfo);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
