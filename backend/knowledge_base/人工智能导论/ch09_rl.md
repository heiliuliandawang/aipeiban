# 第九章：强化学习基础

## 9.1 强化学习框架

强化学习（Reinforcement Learning, RL）研究智能体如何在与环境的交互中学习最优策略。

**核心要素：**
- **智能体（Agent）**：学习和决策的主体
- **环境（Environment）**：智能体交互的对象
- **状态（State, s）**：环境的描述
- **动作（Action, a）**：智能体的选择
- **奖励（Reward, r）**：环境对动作的即时反馈信号
- **策略（Policy, π）**：从状态到动作的映射 π(a|s)

**交互循环：**
```
智能体 --动作a_t--> 环境
环境 --状态s_{t+1}, 奖励r_t--> 智能体
目标：最大化累积折扣奖励 G_t = Σ γ^k r_{t+k}
```

γ（折扣因子）通常取0.9~0.99，控制对未来奖励的重视程度。

---

## 9.2 马尔可夫决策过程（MDP）

MDP是RL的数学框架，满足**马尔可夫性质**：
> 未来状态只依赖当前状态和动作，与历史无关。

$$P(s_{t+1}|s_t, a_t, s_{t-1}, a_{t-1}, \ldots) = P(s_{t+1}|s_t, a_t)$$

**值函数：**
- **状态值函数** V^π(s)：从状态s出发，按策略π的期望累积奖励
- **动作值函数** Q^π(s,a)：在状态s执行动作a，再按策略π的期望累积奖励

**Bellman方程（递推关系）：**
$$V^\pi(s) = \sum_a \pi(a|s) \sum_{s'} P(s'|s,a)[r + \gamma V^\pi(s')]$$

---

## 9.3 Q-Learning ★★★

Q-Learning是无模型的值函数方法，直接学习最优Q值：

$$Q(s,a) \leftarrow Q(s,a) + \alpha \left[ r + \gamma \max_{a'} Q(s',a') - Q(s,a) \right]$$

其中 α 是学习率，方括号内是**TD误差（时序差分误差）**。

```python
import numpy as np

def q_learning(env, episodes=1000, alpha=0.1, gamma=0.99, epsilon=0.1):
    Q = np.zeros((env.n_states, env.n_actions))
    
    for _ in range(episodes):
        s = env.reset()
        done = False
        while not done:
            # ε-贪婪策略：以ε概率随机探索
            if np.random.random() < epsilon:
                a = env.action_space.sample()
            else:
                a = np.argmax(Q[s])
            
            s_next, r, done, _ = env.step(a)
            
            # Q值更新
            td_error = r + gamma * np.max(Q[s_next]) - Q[s]
            Q[s, a] += alpha * td_error
            s = s_next
    
    return Q
```

---

## 9.4 探索与利用的权衡

**探索（Exploration）：** 尝试新动作，可能发现更好的策略
**利用（Exploitation）：** 选择当前已知最好的动作，获取更多奖励

**ε-贪婪（ε-Greedy）策略：**
- 以 1-ε 的概率选择Q值最大的动作
- 以 ε 的概率随机选择动作
- 实践中常用 ε 衰减：从1.0逐渐降至0.01

---

## 9.5 深度强化学习

### DQN（Deep Q-Network，2015 DeepMind）

将Q-Learning与深度神经网络结合，解决高维状态空间问题：
- 用CNN从游戏像素提取状态特征
- 用神经网络近似Q函数
- **经验回放（Experience Replay）**：存储历史转移，随机采样打破时间相关性
- **目标网络（Target Network）**：定期同步的独立网络，稳定训练

```python
import torch.nn as nn

class DQN(nn.Module):
    def __init__(self, state_dim, action_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Linear(128, action_dim)
        )
    
    def forward(self, x):
        return self.net(x)
```

### 策略梯度方法

直接优化策略 π_θ，而非Q值：
$$\nabla_\theta J(\theta) = E_\pi \left[ \nabla_\theta \log \pi_\theta(a|s) \cdot G_t \right]$$

- **REINFORCE**：蒙特卡洛策略梯度，高方差
- **Actor-Critic（A3C/PPO）**：同时学习策略（Actor）和值函数（Critic），降低方差
- **PPO（Proximal Policy Optimization）**：目前最广泛使用的策略梯度算法，RLHF的核心

---

## 9.6 强化学习的典型应用

| 应用 | RL方法 | 成就 |
|------|--------|------|
| 棋类游戏 | AlphaGo(MCTS+DRL) | 超越人类围棋冠军 |
| 视频游戏 | DQN | 超越人类Atari游戏水平 |
| 机器人控制 | SAC, PPO | 精准操控、行走、抓取 |
| 自动驾驶 | Multi-agent RL | 路径规划 |
| 大模型对齐 | RLHF/PPO | ChatGPT核心技术 |

---

## 9.7 常见误区

> **误区：强化学习只能用于游戏**
> RL已广泛应用于推荐系统（动态策略调整）、金融交易（动态资产配置）、供应链优化等现实场景。

> **误区：奖励函数越精确越好**
> 设计不当的奖励函数会导致"奖励黑客"（Reward Hacking）：智能体找到最大化奖励但违背设计意图的策略。奖励塑造（Reward Shaping）是重要研究方向。
