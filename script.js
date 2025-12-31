let socket;
let audioContext;
let processor;
let source;
let commitInterval;

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const status = document.getElementById("status");

// Add a div for logs
const logsDiv = document.createElement("div");
logsDiv.id = "logs";
logsDiv.style.border = "1px solid #ccc";
logsDiv.style.padding = "10px";
logsDiv.style.marginTop = "20px";
logsDiv.style.height = "300px";
logsDiv.style.overflow = "auto";
logsDiv.style.fontFamily = "monospace";
logsDiv.style.fontSize = "12px";
document.body.appendChild(logsDiv);

// Add transcription display
const transDiv = document.createElement("div");
transDiv.id = "transcription";
transDiv.style.border = "2px solid #4CAF50";
transDiv.style.padding = "15px";
transDiv.style.marginTop = "20px";
transDiv.style.minHeight = "50px";
transDiv.style.fontSize = "18px";
transDiv.style.fontWeight = "bold";
transDiv.style.backgroundColor = "#f9f9f9";
document.body.appendChild(transDiv);

function addLog(message, type = "info") {
  const time = new Date().toLocaleTimeString();
  const ms = new Date().getMilliseconds();
  const logEntry = document.createElement("div");
  logEntry.textContent = `[${time}.${ms}] ${message}`;
  logEntry.style.color =
    type === "error"
      ? "red"
      : type === "success"
      ? "green"
      : type === "warning"
      ? "orange"
      : "blue";
  logsDiv.appendChild(logEntry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
  console.log(`[${type.toUpperCase()}] ${message}`);
}

startBtn.onclick = async () => {
  status.innerText = "Connecting...";
  addLog("Starting connection...");

  socket = new WebSocket("wss://asr.captify.glass/v1/realtime");

  socket.onopen = async () => {
    addLog("✅ WebSocket connected", "success");
    status.innerText = "Listening...";
    addLog("🎤 Starting microphone...", "info");
    await startMic();

    // 🔴 REQUIRED: periodic commit
    commitInterval = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }
    }, 700);
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const time = new Date().toLocaleTimeString();
      const ms = new Date().getMilliseconds();
      console.log("⬇️ RAW MESSAGE FROM BACKEND:", event.data);
      // Handle different message types with different colors
      if (msg.type === "debug") {
        addLog(`🔧 DEBUG: ${msg.message}`, "info");
      } else if (msg.type === "session.created") {
        addLog(`📋 SESSION: ${JSON.stringify(msg.session)}`, "success");
      } else if (msg.type === "response.output_text.delta") {
        addLog(`💬 TEXT: "${msg.delta}"`, "success");
        // Update status with live transcription
        status.innerText = msg.delta;

        // Update transcription display
        transDiv.textContent += msg.delta;
        transDiv.style.color = "#4CAF50";
      } else if (msg.type === "response.completed") {
        addLog(`✅ FINAL: "${msg.response.output_text}"`, "success");
        transDiv.textContent = msg.response.output_text;
        transDiv.style.color = "#2196F3";
        transDiv.style.backgroundColor = "#E3F2FD";
      } else {
        addLog(
          `📥 ${msg.type}: ${JSON.stringify(msg).substring(0, 100)}...`,
          "info"
        );
      }
    } catch (e) {
      addLog(`❌ Parse error: ${e}`, "error");
    }
  };

  socket.onerror = (error) => {
    addLog(`❌ WebSocket error: ${error}`, "error");
    status.innerText = "Connection error";
  };

  socket.onclose = () => {
    addLog("🔌 WebSocket closed", "warning");
    status.innerText = "Stopped";
    clearInterval(commitInterval);
  };
};

stopBtn.onclick = () => {
  addLog("🛑 Sending final commit...", "warning");

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "input_audio_buffer.commit",
      })
    );
  }

  stopAll();
};

async function startMic() {
  try {
    addLog("🎤 Requesting microphone permission...", "info");

    audioContext = new AudioContext({ sampleRate: 16000 });
    addLog(
      `✅ AudioContext created. Sample rate: ${audioContext.sampleRate}`,
      "success"
    );

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    addLog("✅ Microphone access granted", "success");

    source = audioContext.createMediaStreamSource(stream);

    // Use smaller buffer for real-time
    const bufferSize = 2048; // 100ms at 16kHz
    processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    let audioChunkCount = 0;
    let lastLogTime = Date.now();

    processor.onaudioprocess = (e) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);

      const GAIN = 1.5;

      for (let i = 0; i < input.length; i++) {
        let s = input[i] * GAIN;

        if (s > 1) s = 1;
        else if (s < -1) s = -1;

        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      socket.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer))),
        })
      );
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    addLog("✅ Audio processing started", "success");
  } catch (error) {
    addLog(`❌ Microphone error: ${error.message}`, "error");
    status.innerText = "Microphone error";
  }
}

function stopAll() {
  if (processor) {
    processor.disconnect();
    addLog("🔌 Disconnected processor", "warning");
  }
  if (source) {
    source.disconnect();
    addLog("🔌 Disconnected source", "warning");
  }
  if (audioContext) {
    audioContext.close();
    addLog("🔌 Closed AudioContext", "warning");
  }
  if (socket) {
    setTimeout(() => {
      socket.close();
      addLog("🔌 Closed WebSocket", "warning");
    }, 500);
  }
  if (commitInterval) {
    clearInterval(commitInterval);
    addLog("⏹️ Cleared commit interval", "warning");
  }
  status.innerText = "Stopped";
  addLog("✅ All stopped", "success");
}

// Clear logs button
const clearBtn = document.createElement("button");
clearBtn.textContent = "Clear Logs";
clearBtn.style.margin = "10px";
clearBtn.style.padding = "10px";
clearBtn.onclick = () => {
  logsDiv.innerHTML = "";
  addLog("Logs cleared", "info");
};
document.body.appendChild(clearBtn);

// Clear transcription button
const clearTransBtn = document.createElement("button");
clearTransBtn.textContent = "Clear Transcription";
clearTransBtn.style.margin = "10px";
clearTransBtn.style.padding = "10px";
clearTransBtn.onclick = () => {
  transDiv.textContent = "";
  addLog("Transcription cleared", "info");
};
document.body.appendChild(clearTransBtn);

// Add some styling
document.body.style.fontFamily = "Arial, sans-serif";
document.body.style.padding = "20px";
