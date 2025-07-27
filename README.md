# Multi-Wallet Automated Plume Script

This Node.js script automates the process of interacting with the WPLUME contract on the Plume Mainnet using multiple wallets.  
It will:

- **Prompt you** for wallet addresses and private keys interactively (no need to edit files manually).
- **Store your credentials** securely in a `.env` file (never commit this file).
- **Automate random wrap/unwrap cycles** on each wallet you add.

---

## 🚀 Quick Start

1. **Install dependencies:**

    ```bash
    npm install ethers dotenv prompt-sync
    ```

2. **Run the script:**

    ```bash
    node index.js
    ```

3. **Follow the prompts** to enter your wallet addresses and private keys.

4. The script will save your credentials to `.env` (in the same directory) and automatically begin the automation for all entered wallets.

---

## ⚙️ What the Script Does

- Asks you how many wallets you want to use.
- For each, prompts for:
    - Public wallet address (0x...)
    - Private key (will not be shown after entry)
- Saves all addresses and keys as comma-separated lists in your `.env` file:
    ```
    WALLET_ADDRESSES=0xabc...,0xdef...
    PRIVATE_KEYS=key1,key2
    ```
- For each wallet, performs 50 cycles of:
    - Random wrap (deposit PLUME for WPLUME)
    - Random unwrap (convert WPLUME back to PLUME)
    - With random delays, proper gas settings, and full logging.

---

## 🔐 Security Warning

- **Never share your `.env` file or private keys!**
- Make sure your `.env` is in your `.gitignore`:
    ```
    .env
    ```
- If you believe your private key has been exposed, move funds and replace the key immediately.

---


