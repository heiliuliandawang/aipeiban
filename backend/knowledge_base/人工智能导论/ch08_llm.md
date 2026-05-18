# 第八章：大语言模型与Transformer

## 8.1 Transformer架构（2017）★★★

Transformer由"Attention Is All You Need"（Vaswani等，2017）提出，彻底取代了RNN成为NLP的主流架构。

**核心思想：** 完全基于注意力机制，放弃循环结构，支持并行计算。

---

## 8.2 自注意力机制（Self-Attention）

自注意力让序列中每个位置都能直接与所有其他位置交互。

**Q、K、V矩阵：**
- **Query（Q）**：当前位置的查询向量（"我想找什么"）
- **Key（K）**：所有位置的键向量（"我有什么"）
- **Value（V）**：所有位置的值向量（"找到后取什么"）

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right) V$$

其中 $\sqrt{d_k}$ 是缩放因子，防止点积过大导致softmax梯度消失。

**直觉示例：**
"The animal didn't cross the street because **it** was too tired"
→ 自注意力帮助"it"关注"animal"（而非"street"）

---

## 8.3 多头注意力（Multi-Head Attention）

并行运行多个注意力头，每个头学习不同类型的关联：

$$\text{MultiHead}(Q,K,V) = \text{Concat}(\text{head}_1,\ldots,\text{head}_h) W^O$$
$$\text{head}_i = \text{Attention}(QW_i^Q, KW_i^K, VW_i^V)$$

---

## 8.4 位置编码（Positional Encoding）

Transformer无循环结构，需要显式注入位置信息：

$$PE_{(pos,2i)} = \sin\left(\frac{pos}{10000^{2i/d_{model}}}\right)$$
$$PE_{(pos,2i+1)} = \cos\left(\frac{pos}{10000^{2i/d_{model}}}\right)$$

---

## 8.5 Transformer完整架构

```
Encoder（编码器）：
  输入嵌入 + 位置编码
  → N × [多头自注意力 → Add&Norm → 前馈网络 → Add&Norm]
  → 编码器输出

Decoder（解码器）：
  目标嵌入 + 位置编码
  → N × [掩码多头自注意力 → Add&Norm 
         → 交叉注意力（Q来自解码器，K/V来自编码器）→ Add&Norm
         → 前馈网络 → Add&Norm]
  → 线性层 → Softmax → 输出概率
```

---

## 8.6 预训练语言模型

### BERT（2018, Google）

- **架构**：仅Encoder
- **预训练任务**：
  - **MLM（掩码语言模型）**：随机遮盖15%词，预测被遮盖的词
  - **NSP（下一句预测）**：判断两句话是否连续
- **特点**：双向上下文理解，适合理解类任务（分类、抽取式QA）

### GPT系列（OpenAI）

- **架构**：仅Decoder
- **预训练任务**：自回归语言模型（根据前文预测下一个词）
- **GPT-3（1750亿参数）**：展示了涌现能力，few-shot学习
- **ChatGPT/GPT-4**：加入RLHF（人类反馈强化学习），大幅提升对话质量

### BERT vs GPT

| 维度 | BERT | GPT |
|------|------|-----|
| 架构 | Encoder-only | Decoder-only |
| 方向 | 双向 | 单向（自左向右）|
| 适合任务 | 分类、NER、QA | 文本生成、对话 |
| 代表模型 | BERT, RoBERTa | GPT-3/4, LLaMA |

---

## 8.7 大语言模型（LLM）关键概念

### 涌现能力（Emergent Abilities）
当模型参数量超过某个阈值时，突然展现出未经专门训练的能力（如数学推理、代码生成）。

### In-Context Learning（上下文学习）
不更新模型参数，仅通过在提示中给出示例，模型即能适应新任务。
- Zero-shot：无示例
- Few-shot：给1-10个示例

### RLHF（基于人类反馈的强化学习）
ChatGPT的核心技术，使模型输出更符合人类偏好：
1. 收集人类对模型输出的偏好数据
2. 训练奖励模型（RM）预测人类偏好分数
3. 用PPO算法优化LLM最大化奖励

### RAG（检索增强生成）
结合外部知识库与LLM：
1. 将用户问题向量化，检索相关文档
2. 将检索到的文档与问题一起输入LLM
3. LLM基于检索内容生成答案
- **优点**：减少幻觉，知识可更新，无需微调

---

## 8.8 常见误区

> **误区：大语言模型"知道"答案**
> LLM是基于统计规律生成文本的，并不"知道"任何事实。它们会产生幻觉（Hallucination），即生成听起来合理但实际错误的内容。

> **误区：参数越多效果越好**
> "规模法则"（Scaling Laws）表明效果随参数量对数增长，但边际收益递减。Mistral 7B等小模型通过高质量数据和架构优化，可超过更大的模型。
