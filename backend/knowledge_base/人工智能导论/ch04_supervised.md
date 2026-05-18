# 第四章：监督学习——回归与分类

## 4.1 线性回归

线性回归假设输出 y 与输入 x 呈线性关系：

$$\hat{y} = w^T x + b = w_1 x_1 + w_2 x_2 + \cdots + w_n x_n + b$$

**损失函数（均方误差 MSE）：**
$$L = \frac{1}{m} \sum_{i=1}^m (\hat{y}^{(i)} - y^{(i)})^2$$

**最小二乘解（解析解）：**
$$w^* = (X^T X)^{-1} X^T y$$

当特征数量大时，用**梯度下降**迭代求解：
$$w \leftarrow w - \alpha \frac{\partial L}{\partial w}$$

---

## 4.2 逻辑回归（分类）

逻辑回归用于二分类问题，通过 **sigmoid 函数**将线性输出映射到 [0,1]：

$$P(y=1|x) = \sigma(w^T x + b) = \frac{1}{1 + e^{-(w^T x + b)}}$$

**损失函数（交叉熵）：**
$$L = -\frac{1}{m} \sum_{i=1}^m [y^{(i)} \log \hat{p}^{(i)} + (1-y^{(i)}) \log(1-\hat{p}^{(i)})]$$

```python
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report

model = LogisticRegression(max_iter=1000, C=1.0)
model.fit(X_train, y_train)
y_pred = model.predict(X_test)
print(classification_report(y_test, y_pred))
```

---

## 4.3 支持向量机（SVM）

SVM 寻找**最大间隔超平面**，使两类样本的间隔最大化。

- **硬间隔 SVM**：要求所有样本正确分类（适用于线性可分数据）
- **软间隔 SVM**：允许部分分类错误（引入松弛变量 ξ，参数 C 控制）
- **核技巧（Kernel Trick）**：通过核函数隐式映射到高维空间处理非线性问题
  - 线性核：K(x,z) = x^T z
  - RBF核（高斯核）：K(x,z) = exp(-γ||x-z||²)（最常用）

---

## 4.4 决策树

决策树通过递归地选择最优特征进行数据划分。

**特征选择准则：**
- **信息增益**（ID3）：IG(A) = H(D) - H(D|A)
- **信息增益比**（C4.5）：解决信息增益偏向多值特征的问题
- **基尼系数**（CART）：Gini(D) = 1 - Σp_k²（scikit-learn默认）

**树的剪枝：**
- **预剪枝**：设置最大深度、最小样本数等停止条件
- **后剪枝**：先生成完整树，再递归地剪去不显著的子树

---

## 4.5 集成方法

### 随机森林（Random Forest）— Bagging

- 训练多棵独立决策树，每棵树用不同的**自助采样**数据集
- 每个节点随机选取 √n 个特征进行划分
- 预测：分类取投票，回归取平均
- **优点**：泛化好，抗过拟合，无需调参多

### 梯度提升树（GBDT/XGBoost）— Boosting

- 顺序训练多棵树，每棵新树拟合前一棵树的**残差**
- XGBoost：加入正则化项、列采样，工程优化极好
- 在结构化数据上通常是最强的传统ML算法

```python
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier

# 随机森林
rf = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
rf.fit(X_train, y_train)

# 梯度提升
gb = GradientBoostingClassifier(n_estimators=100, learning_rate=0.1)
gb.fit(X_train, y_train)
```

---

## 4.6 算法选择指南

| 场景 | 推荐算法 |
|------|---------|
| 小数据集，需要可解释性 | 逻辑回归、决策树 |
| 高维稀疏数据（文本）| SVM（线性核）、逻辑回归 |
| 结构化数据，追求准确率 | XGBoost、随机森林 |
| 大规模数据 | 随机梯度下降（SGD）+ 线性模型 |
| 非线性边界，数据量适中 | SVM（RBF核）、随机森林 |

---

## 4.7 常见误区

> **误区：逻辑回归只能用于线性可分问题**
> 通过添加多项式特征或使用核逻辑回归，可处理非线性边界。

> **误区：决策树越深越好**
> 过深的决策树会严重过拟合。实践中通常限制 max_depth=5~10，并配合剪枝。
