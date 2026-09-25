# 岩芯 CT 纯浏览器查看器

React + TypeScript + vtk.js 实现的本地岩芯 CT 体数据浏览工具。体素文件由 Web Worker 解码，扫描数据不会通过网络上传；工程、体数据、当前坐标、ROI 和标注全部保存在浏览器 IndexedDB。

## 功能

- 三个正交切面（I/X、J/Y、K/Z），点击任意切面同步三平面切片和黄色十字坐标。
- 鼠标滚轮切换当前切面。
- 距离测量按每轴体素物理间距计算：`sqrt((dx*sx)^2 + (dy*sy)^2 + (dz*sz)^2)`。
- 点标注保存三维 IJK 坐标。
- 在切面上拖拽矩形 ROI，显示：
  - IJK 范围、宽高体素数和总数量；
  - 物理面积；
  - ROI 内最小、最大、均值；
  - 阈值内体素数量、占比，并在图上叠加橙色预览。
- 切换切面、返回工程列表或刷新浏览器后，ROI、标注和坐标仍从 IndexedDB 恢复。
- 内置各向异性合成岩芯样例：`48×64×80`，间距 `0.25×0.50×0.75 mm`。

## 运行

```bash
npm install
npm run dev
```

测试和生产构建：

```bash
npm test
npm run build
npm run preview
```

点击首页“载入随项目合成各向异性样例”即可立即使用。首页也可以打开符合下方格式的小体积 `.vvol` 文件。

## VVOX v1 文件格式

小端字节序，64 字节文件头，后接 Fortran/医学图像常用的一维体素数组：

```text
offset  type       field
0       char[4]    magic，必须是 "VVOX"
4       uint16     version = 1
6       uint16     scalarType:
                   1 = uint8
                   2 = int16
                   3 = uint16
                   4 = float32
8       uint32     dimX
12      uint32     dimY
16      uint32     dimZ
20      float32    spacingX，单位 mm，必须 > 0
24      float32    spacingY，单位 mm，必须 > 0
28      float32    spacingZ，单位 mm，必须 > 0
32      float32    originX
36      float32    originY
40      float32    originZ
44..63             保留，首版写 0
64..               scalar data
```

一维索引为：

```text
offset = i + dimX * (j + dimY * k)
```

物理坐标为：

```text
x = originX + i * spacingX
y = originY + j * spacingY
z = originZ + k * spacingZ
```

首版解析器明确校验魔数、版本、维度、间距和数据长度，并且只推荐打开随项目使用的小体积样例，避免把浏览器作为大体积 CT 上传/重采样平台。

## 验证

`src/core.test.ts` 覆盖：

- 合成 `.vvol` 的维度、各向异性间距、数值类型和长度；
- IJK ↔ 物理坐标；
- 非均匀间距下的欧氏距离；
- 单切面矩形 ROI 的体素数量、物理面积和阈值统计。
