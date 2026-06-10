(function () {
  const WIDGET_ID = "tradevault-ai-tablet-widget";
  const PRIMARY_COLOR = "#0ea5e9"; // Sky blue 500
  const DARK_BG = "#0f172a";
  const PANEL_BG = "#1e293b";
  const TEXT_COLOR = "#f8fafc";
  
  const currentScript = document.currentScript;
  const baseUrl = currentScript ? currentScript.getAttribute("data-api-url") || "" : "";

  let isOpen = false;
  let exampleText = 'I need a full rewire for a 3-bed house';
  const url = window.location.href.toLowerCase();
  if (url.includes('carpentry') || url.includes('construction')) {
    exampleText = 'I need to hang 5 internal doors';
  } else if (url.includes('plumbing')) {
    exampleText = 'I need a new combi boiler installed';
  } else if (url.includes('landscaping')) {
    exampleText = 'I need a 20sqm patio laid';
  }

  const initialGreeting = {
    status: "clarifying",
    reply: `Hi! I am the AI Estimation Tool. \nTell me a bit about your project (e.g. "${exampleText}") so I can calculate a quote for you.`
  };

  let chatHistory = [
    {
      role: "model",
      text: JSON.stringify(initialGreeting)
    }
  ];
  let isLoading = false;
  let isQuoting = false;

  // Create Container
  const container = document.createElement("div");
  container.id = WIDGET_ID;
  Object.assign(container.style, {
    position: "fixed",
    bottom: "20px",
    left: "20px",
    zIndex: "999999",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
  });

  // Create Toggle Button (FAB)
  const toggleBtn = document.createElement("button");
  Object.assign(toggleBtn.style, {
    padding: "16px 24px",
    borderRadius: "9999px",
    backgroundColor: PRIMARY_COLOR,
    color: "white",
    border: "none",
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -2px rgba(0,0,0,0.15)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontWeight: "600",
    fontSize: "16px",
    transition: "transform 0.2s, background-color 0.2s"
  });
  toggleBtn.innerHTML = `
    <style>
      @keyframes tv-pulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.15); opacity: 0.8; filter: drop-shadow(0 0 6px #fbbf24); }
        100% { transform: scale(1); opacity: 1; }
      }
      .tv-pulse-gold {
        color: #fbbf24 !important;
        animation: tv-pulse 2s infinite ease-in-out;
      }
    </style>
    <svg class="tv-pulse-gold" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
    Get AI Estimate
  `;
  toggleBtn.onmouseover = () => (toggleBtn.style.transform = "translateY(-2px)");
  toggleBtn.onmouseout = () => (toggleBtn.style.transform = "translateY(0)");

  // Create Modal Overlay
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(4px)",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "1000000"
  });

  // Create Tablet Window
  const tablet = document.createElement("div");
  Object.assign(tablet.style, {
    width: "90%",
    maxWidth: "800px",
    height: "85vh",
    backgroundColor: PANEL_BG,
    borderRadius: "24px",
    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "8px solid #000", // Bezel
    position: "relative"
  });

  // Tablet Header
  const header = document.createElement("div");
  Object.assign(header.style, {
    backgroundColor: DARK_BG,
    color: TEXT_COLOR,
    padding: "20px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid #334155"
  });
  header.innerHTML = `
    <div style="display: flex; flex-direction: column;">
      <h2 style="margin: 0; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${PRIMARY_COLOR};"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
        AI Estimation Tool
      </h2>
      <span style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Powered by TradeVault AI</span>
    </div>
    <button id="close-tablet" style="background:none; border:none; color:#94a3b8; cursor:pointer; padding: 8px; border-radius: 50%; transition: background 0.2s;">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  `;

  // Tablet Body (Messages)
  const bodyArea = document.createElement("div");
  Object.assign(bodyArea.style, {
    flex: "1",
    padding: "32px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    backgroundColor: PANEL_BG,
    color: TEXT_COLOR
  });

  // Input Area
  const inputContainer = document.createElement("form");
  Object.assign(inputContainer.style, {
    padding: "24px",
    backgroundColor: DARK_BG,
    borderTop: "1px solid #334155",
    display: "flex",
    gap: "12px",
    alignItems: "center"
  });

  const inputField = document.createElement("input");
  inputField.type = "text";
  inputField.placeholder = "Describe your requirements...";
  Object.assign(inputField.style, {
    flex: "1",
    padding: "16px 20px",
    borderRadius: "12px",
    border: "1px solid #475569",
    backgroundColor: "#0f172a",
    color: "white",
    outline: "none",
    fontSize: "16px",
    transition: "border-color 0.2s"
  });
  inputField.onfocus = () => inputField.style.borderColor = PRIMARY_COLOR;
  inputField.onblur = () => inputField.style.borderColor = "#475569";

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  Object.assign(sendBtn.style, {
    backgroundColor: PRIMARY_COLOR,
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "16px 32px",
    fontSize: "16px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.2s"
  });
  sendBtn.textContent = "Send";

  inputContainer.appendChild(inputField);
  inputContainer.appendChild(sendBtn);

  tablet.appendChild(header);
  tablet.appendChild(bodyArea);
  tablet.appendChild(inputContainer);
  overlay.appendChild(tablet);

  container.appendChild(toggleBtn);
  document.body.appendChild(container);
  document.body.appendChild(overlay);

  // Styling helpers
  const createFancyQuote = (quoteDetails) => {
    return `
      <div style="background: linear-gradient(145deg, #0f172a, #1e293b); border: 1px solid #334155; border-radius: 16px; padding: 24px; margin-top: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);">
        <h3 style="color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Estimated Quote</h3>
        <div style="font-size: 42px; font-weight: 800; color: ${PRIMARY_COLOR}; margin-bottom: 8px;">${quoteDetails.price}</div>
        <div style="font-size: 13px; color: #64748b; margin-bottom: 24px; font-style: italic;">*We will nail the exact price down once we have been in touch.</div>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #334155; padding-bottom: 8px;">
            <span style="color: #94a3b8;">Estimated Time</span>
            <span style="font-weight: 600;">${quoteDetails.timeEstimate || 'TBD'}</span>
          </div>
          <div style="margin-top: 8px;">
            <span style="color: #94a3b8; display: block; margin-bottom: 8px;">Breakdown:</span>
            <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; line-height: 1.6;">
              ${(quoteDetails.breakdown || []).map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        </div>

        <div style="margin-top: 24px; display: flex; justify-content: flex-end; border-top: 1px solid #334155; padding-top: 16px;">
          <button class="tv-ready-btn" style="background: ${PRIMARY_COLOR}; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
            Ready to Finalise
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    `;
  };

  const createLeadForm = () => {
    return `
      <div style="background: linear-gradient(145deg, #0f172a, #1e293b); border: 1px solid #334155; border-radius: 16px; padding: 20px; margin-top: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);">
        <h3 style="color: white; font-size: 16px; margin: 0 0 16px 0;">Finalise Your Booking</h3>
        <p style="color: #94a3b8; font-size: 14px; margin-top: 0; margin-bottom: 16px;">Please provide your details below and we will contact you to arrange a site visit.</p>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="display: block; color: #cbd5e1; font-size: 13px; margin-bottom: 4px;">Full Name</label>
            <input type="text" id="tv-lead-name" placeholder="John Doe" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; box-sizing: border-box; outline: none;">
          </div>
          <div>
            <label style="display: block; color: #cbd5e1; font-size: 13px; margin-bottom: 4px;">Phone Number</label>
            <input type="tel" id="tv-lead-phone" placeholder="07123 456789" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; box-sizing: border-box; outline: none;">
          </div>
          <button id="tv-lead-submit" style="background: ${PRIMARY_COLOR}; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Submit Details</button>
        </div>
      </div>
    `;
  };

  const renderMessages = () => {
    bodyArea.innerHTML = "";
    chatHistory.forEach(msg => {
      let data = { reply: msg.text, status: "clarifying" };
      if (msg.role === "model") {
        try { data = JSON.parse(msg.text); } catch(e) {}
      }

      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: msg.role === "user" ? "flex-end" : "flex-start",
        width: "100%"
      });

      const bubble = document.createElement("div");
      Object.assign(bubble.style, {
        maxWidth: "85%",
        padding: "16px 20px",
        borderRadius: "16px",
        fontSize: "16px",
        lineHeight: "1.5",
        backgroundColor: msg.role === "user" ? PRIMARY_COLOR : DARK_BG,
        color: msg.role === "user" ? "white" : TEXT_COLOR,
        border: msg.role === "model" ? "1px solid #334155" : "none",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)"
      });
      
      let html = (data.reply || "").replace(/\\n/g, '<br/>');
      bubble.innerHTML = html;
      row.appendChild(bubble);

      if (data.status === "quoting" && data.quoteDetails) {
        const quoteBox = document.createElement("div");
        quoteBox.style.width = "100%";
        quoteBox.style.maxWidth = "85%";
        quoteBox.innerHTML = createFancyQuote(data.quoteDetails);
        
        const readyBtn = quoteBox.querySelector('.tv-ready-btn');
        if (readyBtn) {
          readyBtn.onclick = () => {
            chatHistory.push({ role: 'model', text: '{"status": "lead_form", "reply": ""}', isLocalForm: true });
            renderMessages();
          };
        }
        
        row.appendChild(quoteBox);
      }

      if (data.status === "lead_form" || msg.isLocalForm) {
        bubble.style.display = 'none'; // Hide the text bubble

        const formBox = document.createElement("div");
        formBox.style.width = "100%";
        formBox.style.maxWidth = "85%";
        formBox.innerHTML = createLeadForm();
        
        const submitBtn = formBox.querySelector('#tv-lead-submit');
        if (submitBtn) {
          submitBtn.onclick = () => {
            const name = formBox.querySelector('#tv-lead-name').value;
            const phone = formBox.querySelector('#tv-lead-phone').value;
            if (name && phone) {
              const text = `I am happy with this quote and ready to proceed! My name is ${name} and my phone number is ${phone}.`;
              chatHistory = chatHistory.filter(m => !m.isLocalForm);
              
              // Push the user's message and trigger the backend request using the existing flow
              inputField.value = text;
              const fakeEvent = { preventDefault: () => {} };
              inputContainer.onsubmit(fakeEvent);
            } else {
              alert("Please enter both your Full Name and Phone Number.");
            }
          };
        }
        
        row.appendChild(formBox);
      }

      bodyArea.appendChild(row);
    });

    if (isLoading) {
      const loaderRow = document.createElement("div");
      loaderRow.style.display = "flex";
      loaderRow.style.justifyContent = "flex-start";
      
      const loader = document.createElement("div");
      Object.assign(loader.style, {
        padding: "16px 20px",
        borderRadius: "16px",
        backgroundColor: DARK_BG,
        border: "1px solid #334155",
        color: PRIMARY_COLOR,
        fontWeight: "600",
        display: "flex",
        alignItems: "center",
        gap: "12px"
      });
      
      const text = isQuoting ? "Calculating materials & labour..." : "Thinking...";
      loader.innerHTML = `
        <svg class="tv-spinner" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
        ${text}
      `;
      
      // Inject spinner keyframes if not exists
      if (!document.getElementById("tv-spinner-style")) {
        const style = document.createElement("style");
        style.id = "tv-spinner-style";
        style.innerHTML = "@keyframes tv-spin { 100% { transform: rotate(360deg); } } .tv-spinner { animation: tv-spin 1s linear infinite; }";
        document.head.appendChild(style);
      }

      loaderRow.appendChild(loader);
      bodyArea.appendChild(loaderRow);
    }

    const lastRow = bodyArea.lastElementChild;
    if (lastRow) {
      // Scroll to the top of the newly added message instead of the absolute bottom
      // This ensures the AI's text response isn't pushed off-screen by the tall quote card
      bodyArea.scrollTop = lastRow.offsetTop - 20;
    } else {
      bodyArea.scrollTop = bodyArea.scrollHeight;
    }
  };

  const toggleModal = () => {
    isOpen = !isOpen;
    overlay.style.display = isOpen ? "flex" : "none";
    if (isOpen) {
      renderMessages();
      inputField.focus();
    }
  };

  window.toggleTradeVaultAiTablet = toggleModal;

  toggleBtn.onclick = toggleModal;
  header.querySelector("#close-tablet").onclick = toggleModal;
  overlay.onclick = (e) => {
    if (e.target === overlay) toggleModal();
  };

  inputContainer.onsubmit = async (e) => {
    e.preventDefault();
    const text = inputField.value.trim();
    if (!text || isLoading) return;

    chatHistory.push({ role: "user", text });
    inputField.value = "";
    isLoading = true;
    
    // Check if we were already clarifying, then we might be transitioning to quote soon
    const lastModelStatus = chatHistory.slice().reverse().find(m => m.role === "model");
    let statusHint = "clarifying";
    if (lastModelStatus) {
      try {
        const j = JSON.parse(lastModelStatus.text);
        if (j.status === "clarifying") isQuoting = true; // Give user impression we are calculating
      } catch(e){}
    }

    renderMessages();

    try {
      const response = await fetch(baseUrl + "/api/public/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Filter history to just raw text or the stringified JSON
          history: chatHistory.slice(0, -1).map(m => ({ role: m.role, text: m.text })),
          message: text,
          source: window.location.hostname
        })
      });

      if (!response.ok) throw new Error("API Error");

      const data = await response.json();
      chatHistory.push({ role: "model", text: JSON.stringify(data) });
      
    } catch (err) {
      console.error("Chat widget error:", err);
      chatHistory.push({ role: "model", text: JSON.stringify({status: "clarifying", reply: "Sorry, I encountered an error connecting to the server. Please try again."}) });
    } finally {
      isLoading = false;
      isQuoting = false;
      renderMessages();
    }
  };

  renderMessages();

})();
