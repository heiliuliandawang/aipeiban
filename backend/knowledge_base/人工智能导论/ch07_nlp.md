# 第七章：自然语言处理基础

## 7.1 NLP的核心挑战

自然语言处理（NLP）面临独特挑战：
- **歧义性**：同一词/句可有多种含义（"苹果"可指水果或公司）
- **语境依赖**：含义随上下文变化
- **稀疏性**：词汇量大，数据稀疏
- **隐含知识**：需要常识推理

---

## 7.2 文本表示

### 词袋模型（Bag of Words）
忽略词序，用词频向量表示文本。
- 优点：简单高效
- 缺点：无语序信息，维度高（等于词汇表大小），无法捕捉语义相似性

### TF-IDF
$$\text{TF-IDF}(t, d) = \text{TF}(t,d) \times \log\frac{N}{\text{DF}(t)}$$
- TF（词频）× IDF（逆文档频率），降低常见词权重，突出关键词

### 词向量（Word Embeddings）

**Word2Vec（2013, Google）：** 将每个词映射为低维稠密向量（如300维），语义相似的词在向量空间中距离近。

两种训练方式：
- **CBOW（Continuous Bag of Words）**：用上下文预测中心词
- **Skip-gram**：用中心词预测上下文（对低频词效果更好）

```
经典类比关系（词向量减法）：
vec("国王") - vec("男人") + vec("女人") ≈ vec("女王")
vec("北京") - vec("中国") + vec("法国") ≈ vec("巴黎")
```

**GloVe（Stanford）：** 基于全局词共现矩阵训练，结合了全局统计和局部上下文信息。

---

## 7.3 循环神经网络（RNN）

RNN 通过隐状态（hidden state）传递序列信息：

$$h_t = \tanh(W_h h_{t-1} + W_x x_t + b)$$

**问题：** 普通RNN存在**梯度消失/爆炸**，难以捕捉长距离依赖。

### LSTM（Long Short-Term Memory）★★★

LSTM通过**门控机制**解决长依赖问题：

- **遗忘门**：决定丢弃细胞状态中的哪些信息
  $f_t = \sigma(W_f [h_{t-1}, x_t] + b_f)$
- **输入门**：决定新信息中哪些存入细胞状态
  $i_t = \sigma(W_i [h_{t-1}, x_t] + b_i)$
- **输出门**：决定输出细胞状态的哪个部分
  $o_t = \sigma(W_o [h_{t-1}, x_t] + b_o)$

```python
import torch.nn as nn

lstm = nn.LSTM(
    input_size=300,    # 词向量维度
    hidden_size=256,   # 隐状态维度
    num_layers=2,      # LSTM层数
    dropout=0.3,
    bidirectional=True # 双向LSTM（同时考虑前后文）
)
```

### GRU（Gated Recurrent Unit）
LSTM的简化版，只有重置门和更新门，参数更少，训练更快。

---

## 7.4 常见NLP任务

| 任务 | 示例 | 常用方法 |
|------|------|---------|
| 文本分类 | 情感分析、新闻分类 | LSTM、BERT |
| 序列标注 | 命名实体识别（NER） | BiLSTM-CRF |
| 机器翻译 | 中英互译 | Seq2Seq + Attention、Transformer |
| 问答系统 | 阅读理解 | BERT + 抽取式QA |
| 文本生成 | 摘要、对话 | GPT类语言模型 |

---

## 7.5 注意力机制（Attention）★★★

注意力机制让模型在处理每个词时，能"关注"输入序列中最相关的部分。

**Bahdanau Attention（2014）：**
$$\alpha_{ij} = \frac{\exp(e_{ij})}{\sum_k \exp(e_{ik})}, \quad e_{ij} = a(s_{i-1}, h_j)$$

Context向量：$c_i = \sum_j \alpha_{ij} h_j$

**直觉：** 翻译"猫"时，模型主要关注源句中的"cat"，而非所有词。这使得翻译质量大幅提升。

---

## 7.6 文本预处理

```python
import re
from collections import Counter

def preprocess(text):
    text = text.lower()                          # 小写
    text = re.sub(r'[^\w\s]', '', text)          # 去标点
    tokens = text.split()                         # 分词（中文需jieba）
    return tokens

# 构建词汇表
def build_vocab(corpus, max_size=10000):
    counter = Counter(word for sent in corpus for word in preprocess(sent))
    vocab = ['<PAD>', '<UNK>'] + [w for w, _ in counter.most_common(max_size-2)]
    word2idx = {w: i for i, w in enumerate(vocab)}
    return word2idx
```

---

## 7.7 常见误区

> **误区：词向量可以完全捕捉词义**
> 传统词向量（Word2Vec）为每个词分配**固定**向量，无法处理多义词（"苹果"在不同语境含义不同）。BERT等上下文嵌入模型解决了这个问题。

> **误区：LSTM已经过时，不需要学了**
> LSTM在处理序列数据（时间序列、语音）方面仍有应用价值，且计算资源占用少于Transformer。理解LSTM是学习Transformer的基础。
