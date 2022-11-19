import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/1jYmBJ9ickqZottNZRdvOT8ZviI9W9ZX`,
        enabled: process.env.FORK === 'true',
        blockNumber: 10110776,
      },
    },
  },
};

export default config;
