# 第五章：神经网络与深度学习入门

## 5.1 生物神经元与感知机

**感知机（Perceptron）：** 最简单的神经网络单元，1958年由Rosenblatt提出。

$$\hat{y} = \text{sign}(w^T x + b)$$

**多层感知机（MLP）：** 通过堆叠多层神经元，引入非线性激活函数，理论上可逼近任意连续函数（通用近似定理）。

---

## 5.2 激活函数

激活函数引入非线性，是神经网络表达能力的关键。

| 激活函数 | 公式 | 优点 | 缺点 |
|---------|------|------|------|
| Sigmoid | 1/(1+e^{-x}) | 输出[0,1] | 梯度消失，计算慢 |
| Tanh | (e^x-e^{-x})/(e^x+e^{-x}) | 零中心 | 梯度消失 |
| ReLU | max(0, x) | 计算快，缓解梯度消失 | 死亡ReLU问题 |
| Leaky ReLU | max(αx, x), α≈0.01 | 解决死亡ReLU | - |
| GELU | x·Φ(x) | Transformer常用 | 计算稍慢 |

> **死亡ReLU（Dying ReLU）：** 当神经元的输入持续为负时，梯度为0，该神经元永久停止更新。解决方案：使用Leaky ReLU或合理的权重初始化。

---

## 5.3 前向传播与反向传播

### 前向传播（Forward Pass）

逐层计算每个神经元的输出：
$$a^{[l]} = f(W^{[l]} a^{[l-1]} + b^{[l]})$$

### 反向传播（Backpropagation）★★★ 核心算法

基于**链式法则**，从输出层向输入层反向计算各参数的梯度：

$$\frac{\partial L}{\partial W^{[l]}} = \frac{\partial L}{\partial a^{[l]}} \cdot \frac{\partial a^{[l]}}{\partial z^{[l]}} \cdot \frac{\partial z^{[l]}}{\partial W^{[l]}}$$

**直觉理解：** 误差信号从输出层"反向流动"，告诉每一层参数应该朝哪个方向调整。

```python
import numpy as np

def sigmoid(z):
    return 1 / (1 + np.exp(-z))

def forward(X, W1, b1, W2, b2):
    Z1 = X @ W1.T + b1
    A1 = sigmoid(Z1)
    Z2 = A1 @ W2.T + b2
    A2 = sigmoid(Z2)
    return A1, A2

def backward(X, y, A1, A2, W2):
    m = X.shape[0]
    dZ2 = A2 - y
    dW2 = dZ2.T @ A1 / m
    dZ1 = (dZ2 @ W2) * A1 * (1 - A1)
    dW1 = dZ1.T @ X / m
    return dW1, dW2
```

---

## 5.4 梯度下降优化器

### 批量梯度下降（BGD）
- 每次更新使用**全部训练数据**
- 稳定但每步计算代价高

### 随机梯度下降（SGD）
- 每次更新使用**单个样本**
- 更新频繁，但梯度噪声大，收敛不稳定

### 小批量梯度下降（Mini-Batch GD）
- 每次使用 32/64/128 个样本（最常用）
- 结合了BGD的稳定性与SGD的效率

### 自适应优化器

- **Momentum**：积累历史梯度方向，加速收敛
- **Adam（推荐默认）**：结合Momentum与RMSProp，自适应调整学习率

$$m_t = \beta_1 m_{t-1} + (1-\beta_1)g_t \quad v_t = \beta_2 v_{t-1} + (1-\beta_2)g_t^2$$
$$\theta \leftarrow \theta - \frac{\alpha}{\sqrt{\hat{v}_t} + \epsilon} \hat{m}_t$$

---

## 5.5 关键训练技巧

### 权重初始化
- **Xavier初始化**：适用于Sigmoid/Tanh，W ~ N(0, 1/n_in)
- **He初始化**：适用于ReLU，W ~ N(0, 2/n_in)

### Batch Normalization（批归一化）
- 对每一层的输入进行归一化，使均值为0、方差为1
- 加快训练速度，允许使用更大学习率，有轻微正则化效果

### Dropout
- 训练时随机"丢弃"一定比例的神经元
- 等效于训练多个不同网络的集成，减少过拟合

### 学习率调度
- **余弦退火（Cosine Annealing）**：学习率随训练进行余弦衰减
- **ReduceLROnPlateau**：验证损失不下降时自动降低学习率

---

## 5.6 深度学习框架

```python
# PyTorch 示例
import torch
import torch.nn as nn

class MLP(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_dim, output_dim)
        )
    
    def forward(self, x):
        return self.net(x)

model = MLP(784, 256, 10)
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
criterion = nn.CrossEntropyLoss()
```

---

## 5.7 常见误区

> **误区：网络越深越好**
> 过深的网络会遇到梯度消失/爆炸问题。ResNet通过残差连接解决了这个问题，才使得极深网络（100+层）成为可能。

> **误区：神经网络是黑盒，无法理解**
> 可解释AI（XAI）领域提供了多种工具：SHAP值、Grad-CAM（可视化CNN注意区域）等，帮助理解神经网络决策。
