# 第六章：卷积神经网络（CNN）

## 6.1 为什么需要CNN

全连接网络处理图像的问题：
- 1000×1000 RGB图像 → 300万输入维度 → 参数爆炸
- 无法利用图像的**空间局部性**（相邻像素相关性强）
- 无法处理**平移不变性**（猫在图片左边和右边都是猫）

CNN通过**局部感受野**和**权重共享**解决这些问题。

---

## 6.2 卷积操作

**卷积核（Filter/Kernel）：** 一个小矩阵（如3×3），在输入上滑动并做点积。

```
输入(5×5)    卷积核(3×3)    输出特征图(3×3)
1 2 3 4 5    1 0 1           4 3 4
6 7 8 9 0  × 0 1 0  =       2 4 3
1 2 3 4 5    1 0 1           ...
```

**超参数：**
- **步长（Stride）**：卷积核每次移动的像素数
- **填充（Padding）**：在输入边缘添加0，保持尺寸
- 输出尺寸：⌊(H + 2P - F) / S⌋ + 1

**参数共享：** 同一特征图的所有位置共享同一个卷积核参数，大幅减少参数量。

---

## 6.3 CNN的基本组件

### 卷积层（Conv Layer）
- 多个卷积核提取不同特征（低层：边缘、纹理；高层：语义特征）
- 输出多个特征图（Feature Maps）

### 池化层（Pooling Layer）
- **最大池化（Max Pooling）**：取区域内最大值，保留最显著特征
- **平均池化（Average Pooling）**：取平均值
- 作用：降低特征图尺寸，增大感受野，提供平移不变性

### 全连接层（FC Layer）
- 将特征图展平后接全连接层进行最终分类

```python
import torch.nn as nn

class SimpleCNN(nn.Module):
    def __init__(self, num_classes=10):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, kernel_size=3, padding=1),   # 卷积层
            nn.ReLU(),
            nn.MaxPool2d(2, 2),                             # 池化层
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2, 2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 8 * 8, 512),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(512, num_classes),
        )
    
    def forward(self, x):
        return self.classifier(self.features(x))
```

---

## 6.4 经典CNN架构演进

| 架构 | 年份 | 创新点 | ImageNet Top-5错误率 |
|------|------|--------|---------------------|
| AlexNet | 2012 | ReLU、Dropout、GPU训练 | 15.3% |
| VGGNet | 2014 | 小卷积核（3×3）堆叠 | 6.7% |
| GoogLeNet | 2014 | Inception模块、多尺度特征 | 6.7% |
| ResNet | 2015 | **残差连接**，152层 | 3.57% |
| DenseNet | 2017 | 密集连接，特征复用 | 3.46% |
| EfficientNet | 2019 | 网络宽度/深度/分辨率联合缩放 | ~2% |

---

## 6.5 残差网络（ResNet）★★★

ResNet 解决了深层网络梯度消失/退化问题。

**残差块：**
$$H(x) = F(x) + x$$

其中 F(x) 是需要学习的残差映射，x 是恒等快捷连接（shortcut）。

**直觉理解：** 与其让网络学习完整映射 H(x)，不如让它学习残差 F(x) = H(x) - x。当最优映射接近恒等时，让 F(x) → 0 比直接学习恒等映射更容易。

```python
class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)
        self.relu = nn.ReLU()
    
    def forward(self, x):
        residual = x
        out = self.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        return self.relu(out + residual)  # 关键：加上残差连接
```

---

## 6.6 迁移学习

在实际项目中，**迁移学习**（Transfer Learning）是标准做法：
1. 加载在 ImageNet 预训练的模型权重
2. 冻结前层参数（提取通用特征）
3. 只微调最后几层（适应目标任务）

```python
import torchvision.models as models

model = models.resnet50(pretrained=True)
for param in model.parameters():
    param.requires_grad = False  # 冻结所有层

# 替换最后的全连接层
model.fc = nn.Linear(2048, num_classes)  # 只训练这一层
```

---

## 6.7 常见误区

> **误区：池化层会损失重要信息**
> 最大池化保留了最显著的激活特征。在实践中，全卷积网络（无池化）在某些任务（如目标检测）中表现更好，但池化在分类任务中仍是标准选择。

> **误区：通道数越多效果越好**
> 增加通道数会平方级增加计算量。EfficientNet等研究表明，同时缩放深度、宽度和分辨率才是最优的扩展策略。
