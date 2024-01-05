import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { ACCOUNTS_AND_KEYS } from "./test/helpers/constants";

const accounts = ACCOUNTS_AND_KEYS.map((x) => x.key);

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      {
        version: "0.6.12",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  networks: {
    sandverse: {
      url: "https://rpc.sandverse.oasys.games/",
      chainId: 20197,
      gasPrice: 0,
      accounts,
    },
    localhub: {
      url: "http://127.0.0.1:8545/",
      chainId: 12345,
      accounts,
    },
    localverse: {
      url: "http://127.0.0.1:18545/",
      chainId: 420,
      gasPrice: 0,
      accounts,
    },
  },
};

export default config;
