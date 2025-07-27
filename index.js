// Save as: run-multiwallet.js
// To run: node run-multiwallet.js

const fs = require('fs');
const path = require('path');

// Prompt user for addresses/keys if .env not found or user wants to update
const prompt = require('prompt-sync')({sigint: true});

function setupEnvInteractive() {
  console.log("=== Multi-wallet Setup ===");
  let num = 0;
  while (num <= 0 || isNaN(num)) {
    num = Number(prompt("How many wallets do you want to configure? (e.g. 2): "));
  }
  const addresses = [];
  const keys = [];
  for (let i = 0; i < num; i++) {
    console.log(`\nWallet #${i + 1}:`);
    addresses.push(prompt("  Public Address (0x...): ").trim());
    keys.push(prompt("  Private Key: ").trim());
  }
  const envContent = `WALLET_ADDRESSES=${addresses.join(',')}\nPRIVATE_KEYS=${keys.join(',')}\n`;
  fs.writeFileSync(path.resolve(process.cwd(), '.env'), envContent);
  console.log("\n✅ .env file written with your wallet addresses and keys.\n");
}

if (!fs.existsSync('.env')) {
  setupEnvInteractive();
} else {
  // .env exists, ask if user wants to overwrite
  const ans = prompt(".env file already exists. Use previous wallets? (y/n): ");
  if (ans.trim().toLowerCase().startsWith('n')) {
    setupEnvInteractive();
  } else {
    console.log("Using existing .env file...\n");
  }
}

(async () => {
  import('crypto-random-string').then(async ({ default: cryptoRandomString }) => {
    const { ethers } = require("ethers");
    require("dotenv").config();

    // Config
    const CONFIG = {
      rpcUrl: "https://rpc-plume-mainnet-1.t.conduit.xyz/JQN9PNynmFJFJVE9J64p2JGpi2it5DAnU",
      chainId: 98866,
      privateKeys: process.env.PRIVATE_KEYS.split(',').map(pk => pk.trim()),
      wplumeTokenAddress: "0xEa237441c92CAe6FC17Caaf9a7acB3f953be4bd1",
      interactions: 50,
      minAmount: 0.01,
      maxAmount: 0.1,
      gasLimit: 100000,
      maxPriorityFeePerGasGwei: 5,
      maxFeePerGasGwei: 1000,
      delayMinMs: 10000,
      delayMaxMs: 30000,
      maxRetries: 10,
      retryDelayMs: 2000,
    };

    const WPLUME_ABI = [
      "function deposit() public payable",
      "function withdraw(uint256 wad) public",
      "function balanceOf(address account) public view returns (uint256)",
    ];

    function getRandomAmount(min, max) {
      return (Math.random() * (max - min) + min).toFixed(6);
    }

    async function randomDelay() {
      const delay = Math.floor(Math.random() * (CONFIG.delayMaxMs - CONFIG.delayMinMs + 1)) + CONFIG.delayMinMs;
      console.log(`Waiting ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    async function withRetry(fn, maxRetries = CONFIG.maxRetries, retryDelayMs = CONFIG.retryDelayMs) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          if (error.code === "UNKNOWN_ERROR" && error.error?.code === -32017) {
            console.warn(`Rate limit exceeded, retrying (${attempt}/${maxRetries}) after ${retryDelayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            retryDelayMs *= 2;
          } else {
            throw error;
          }
        }
      }
      throw new Error(`Max retries (${maxRetries}) exceeded for rate limit error`);
    }

    async function checkBalance(provider, wplumeContract, address) {
      const nativeBalance = await provider.getBalance(address);
      const wrappedBalance = await wplumeContract.balanceOf(address);
      return {
        native: ethers.formatEther(nativeBalance),
        wrapped: ethers.formatEther(wrappedBalance),
      };
    }

    async function getGasPrices(provider) {
      try {
        const feeData = await provider.getFeeData();
        return {
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits(CONFIG.maxPriorityFeePerGasGwei.toString(), "gwei"),
          maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits(CONFIG.maxFeePerGasGwei.toString(), "gwei"),
        };
      } catch (error) {
        console.warn(`Failed to fetch dynamic gas prices, using defaults: ${error.message}`);
        return {
          maxPriorityFeePerGas: ethers.parseUnits(CONFIG.maxPriorityFeePerGasGwei.toString(), "gwei"),
          maxFeePerGas: ethers.parseUnits(CONFIG.maxFeePerGasGwei.toString(), "gwei"),
        };
      }
    }

    async function wrapPlume(wplumeContract, amount, gasPrices) {
      try {
        const amountWei = ethers.parseEther(amount.toString());
        const tx = await wplumeContract.deposit({
          value: amountWei,
          gasLimit: CONFIG.gasLimit,
          maxPriorityFeePerGas: gasPrices.maxPriorityFeePerGas,
          maxFeePerGas: gasPrices.maxFeePerGas,
        });
        console.log(`Wrapping ${amount} PLUME, Tx Hash: ${tx.hash}`);
        const receipt = await withRetry(() => tx.wait(), CONFIG.maxRetries, CONFIG.retryDelayMs);
        console.log(`Wrap confirmed: ${receipt.hash}`);
        return receipt;
      } catch (error) {
        console.error(`Wrap failed: ${error.message}`);
        throw error;
      }
    }

    async function unwrapPlume(wplumeContract, amount, gasPrices) {
      try {
        const amountWei = ethers.parseEther(amount.toString());
        const tx = await wplumeContract.withdraw(amountWei, {
          gasLimit: CONFIG.gasLimit,
          maxPriorityFeePerGas: gasPrices.maxPriorityFeePerGas,
          maxFeePerGas: gasPrices.maxFeePerGas,
        });
        console.log(`Unwrapping ${amount} WPLUME, Tx Hash: ${tx.hash}`);
        const receipt = await withRetry(() => tx.wait(), CONFIG.maxRetries, CONFIG.retryDelayMs);
        console.log(`Unwrap confirmed: ${receipt.hash}`);
        return receipt;
      } catch (error) {
        console.error(`Unwrap failed: ${error.message}`);
        throw error;
      }
    }

    async function mainForWallet(privateKey, walletIndex) {
      console.log(`\n======= Starting for Wallet #${walletIndex + 1} =======`);
      const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl, CONFIG.chainId);
      const wallet = new ethers.Wallet(privateKey, provider);
      const wplumeContract = new ethers.Contract(CONFIG.wplumeTokenAddress, WPLUME_ABI, wallet);

      let balances = await checkBalance(provider, wplumeContract, wallet.address);
      console.log(`Initial Balances [${wallet.address}]: Native PLUME: ${balances.native}, WPLUME: ${balances.wrapped}`);

      for (let i = 0; i < CONFIG.interactions; i++) {
        console.log(`\n[Wallet #${walletIndex + 1}] Cycle ${i + 1}/${CONFIG.interactions}`);
        const gasPrices = await getGasPrices(provider);

        // Check native PLUME balance
        balances = await checkBalance(provider, wplumeContract, wallet.address);
        const gasEstimate = ethers.parseUnits(CONFIG.maxFeePerGasGwei.toString(), "gwei") * BigInt(CONFIG.gasLimit);
        const maxWrapPossible = parseFloat(balances.native) - parseFloat(ethers.formatEther(gasEstimate)) - 0.01;
        if (maxWrapPossible < CONFIG.minAmount) {
          console.error(`[Wallet #${walletIndex + 1}] Insufficient native PLUME for wrapping.`);
          break;
        }

        // Wrap random amount
        const wrapAmount = getRandomAmount(CONFIG.minAmount, Math.min(CONFIG.maxAmount, maxWrapPossible));
        await wrapPlume(wplumeContract, wrapAmount, gasPrices);
        await randomDelay();

        // Balance after wrap
        balances = await checkBalance(provider, wplumeContract, wallet.address);
        console.log(`After wrap [${wallet.address}]: Native PLUME: ${balances.native}, WPLUME: ${balances.wrapped}`);

        // Check WPLUME balance
        const maxUnwrapPossible = parseFloat(balances.wrapped);
        if (maxUnwrapPossible < CONFIG.minAmount) {
          console.error(`[Wallet #${walletIndex + 1}] Insufficient WPLUME for unwrapping.`);
          continue;
        }

        // Unwrap random amount
        const unwrapAmount = getRandomAmount(CONFIG.minAmount, Math.min(CONFIG.maxAmount, maxUnwrapPossible));
        await unwrapPlume(wplumeContract, unwrapAmount, gasPrices);
        await randomDelay();

        // Balance after unwrap
        balances = await checkBalance(provider, wplumeContract, wallet.address);
        console.log(`After unwrap [${wallet.address}]: Native PLUME: ${balances.native}, WPLUME: ${balances.wrapped}`);
      }
      console.log(`======= Completed for Wallet #${walletIndex + 1} (${wallet.address}) =======`);
    }

    async function main() {
      console.log("Starting multi-wallet WPLUME wrap/unwrap script on Plume Mainnet...");
      for (let i = 0; i < CONFIG.privateKeys.length; i++) {
        try {
          await mainForWallet(CONFIG.privateKeys[i], i);
        } catch (error) {
          console.error(`Wallet #${i + 1} failed:`, error);
        }
      }
      console.log("Script completed for all wallets.");
    }

    main()
      .catch((error) => {
        console.error("Script failed:", error);
        process.exit(1);
      })
      .finally(() => {
        console.log("Exiting...");
        process.exit(0);
      });

  });
})();


