const express = require("express");
const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.status(200).send("✅ MONARCH IA ONLINE");
});

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    bot: "MONARCH IA",
    uptime: process.uptime()
  });
});

app.post("/webhook/asaas", (req, res) => {
  console.log("===== WEBHOOK ASAAS =====");
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).json({
    success: true,
    received: true
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor Web iniciado na porta " + PORT);
});
