# Ngọc Cổ Tứ Linh · landing + 3D card showcase

Sàn diễn 3D (three.js) cho bộ bài board game: lá nhân vật + lá đòn đánh. Chạy local,
thêm ảnh không cần build lại.

## Chạy

Nhấn đôi `start.bat` → mở http://localhost:5173

Hoặc bằng tay:

```bash
npm install      # lần đầu
npm run build    # tạo vendor/bundle.js
npm start        # server ở :5173
```

Sửa code: `npm run watch` (rebuild tự động khi lưu `src/*.js`), rồi F5.

## Thả ảnh vào là xong

Server quét **đệ quy** `assets/cards/`; **tên thư mục** quyết định loại lá:

| Thư mục chứa từ khoá | Ra cái gì |
|---|---|
| `nv`, `nhân vật`, `role`, `character` | lá nhân vật · hàng trước, to hơn |
| `oánh`, `đòn`, `battle`, `action`, `feature` | lá đòn đánh · hàng sau |
| `token`, `ngọc`, `chip` | bỏ qua, không thành lá |

Ngoài thư mục thì xét tiền tố tên file: `role-*`, `feature-*`, `token-*`.
Tên `logo*`, `màu*`, `bàn*`, `board*` bị bỏ qua (không thành lá).

- Ảnh tỉ lệ nào cũng chạy · crop kiểu cover vào khung 3:4. Bộ hiện tại: 711x945.
  PNG / JPG / WEBP / AVIF. Tối đa 32 lá.
- `assets/cards/titles.json`: tên + ghi chú theo tên file. Dạng ngắn `"1": "Thần Kiếm"`, hoặc đầy đủ `"1": {"title": "Thần Kiếm", "note": "Sử dụng bài được 1 điểm"}`. Sửa file rồi F5, không cần build.
- `assets/cards/logo.png` tự động thay chữ "ARCA" ở góc trên trái.
- `assets/cards/DFVN GLD Display Black.otf` tự động dùng cho tiêu đề panel.
- Thư mục trống → cả bộ bài được vẽ procedural (canvas), vẫn chạy đẹp.
- Chưa dùng: `bàn trung tâm.png` (mặt bàn) · muốn làm bàn dưới chân lá thì nói.

## Mặt sau + mây

| Thư mục | Dùng cho |
|---|---|
| `assets/mặt sau của thẻ/` | mặt sau lá bài, khớp theo từ khoá trong tên file |
| `assets/mây/` | mây trôi ở nền sau các lá (sprite additive, tự bơi + xoay nhẹ) |

Mặt sau khớp theo `back` trong `titles.json` (`item`, `nhiệm vụ`, `biểu quyết`,
`nhân vật`), mặc định: lá nhân vật → `nhân vật`, còn lại → `item`.
Mây: tối đa 9 ảnh, mỗi ảnh một dòng trong `CLOUD_SLOTS` = [x, y, z, rộng, độ mờ].
Bố cục đặt tay: 4 đám nhỏ viền góc, 2 đám lớn chìm sâu, không đám nào băng qua
vùng bài (|x| < 3.4). Rộng 1.3–3.2, mờ 0.055–0.105.

## Hai màn hình

Trang cao 200vh, canvas fixed:
- **0 → 100vh**: hero. Cột trái tiêu đề + đoạn dẫn + nút `Xem bộ bài`; lá bài dồn thành quạt
  hẹp ở bên phải (portrait: nằm dưới khối chữ).
- **100vh**: màn showcase (giữ nguyên bố cục đã chốt).
- Bấm nút hoặc lăn chuột: lá hạ xuống + xoè ra, chữ mờ dần rồi biến mất, HUD hiện lên.
  Mọi chuyển động đi qua một biến `state.stage` (0→1) damped, nên kéo lên/xuống đều mượt.

Chỉnh hero: `ox`/`oy` trong `animate()` (đơn vị khung hình, tự đổi theo aspect; desktop
`oy = 0` để quạt căn giữa dọc, portrait đẩy xuống dưới khối chữ) và
`spread = 0.42 + 0.58 * stage` trong `layoutTargets()`.

## Điều khiển

- Rê chuột: lá nghiêng theo con trỏ, camera parallax
- Click lá: soi lá (camera tiến, các lá khác lùi + tối, cột thông tin bên phải)
- `←` `→`: đổi lá đang soi · `Space`: lật mặt sau · `Esc`: thoát
- Click vùng trống: thoát soi

## Cấu trúc

```
index.html        HUD + cột thông tin + @font-face DFVN
src/app.js        scene, ánh sáng, animation, tương tác, bố cục 2 hàng
src/cardart.js    vẽ lá bài procedural (chỉ dùng khi thiếu ảnh)
server.js         static server + /api/cards (quét đệ quy, giữ tên thư mục)
vendor/bundle.js  bundle three.js + app (esbuild)
assets/cards/     ảnh lá bài, logo, font, token
```

## Vặn tham số nhanh

Mở console (F12), gõ `ARCA` · đã expose sẵn:

```js
ARCA.bloom.strength = 0.9
ARCA.renderer.toneMappingExposure = 1.5
ARCA.cards[0].tokens[0].root.position.z += 0.05   // token nhô cao hơn
ARCA.state.focusIdx = 4                            // soi lá số 4
```

Cấu hình quạt: `ROWS` có `step` (bước xoè) và phần lùi theo cấp số (`0.05*|i-mid|`,
`0.05*i`) · hai số này giữ các lá không cắt vào nhau; hover đẩy lá ra theo pháp tuyến
`0.72` nên không bao giờ xuyên lá kế bên.

Ánh sáng hai chế độ: `LIGHT.home` (cảnh quạt) / `LIGHT.focus` (khi soi lá)
sửa số ở đó để chỉnh độ sáng từng chế độ. Bố cục ở đầu `src/app.js`: `ROWS`, `FAN_R`, `FOV`,
`CAM_HOME`, `CAM_FOCUS`, `CARD_W/CARD_H`.

## Ghi chú

- Phải chạy qua server (`npm start`): mở `index.html` bằng `file://` sẽ không
  thấy ảnh vì WebGL chặn texture `file://`.
- Quạt tự thu hẹp theo tỉ lệ khung (`fitRoot`) và tự khép bước khi khung hẹp
  không bao giờ tràn mép, kể cả portrait.
- `prefers-reduced-motion` được tôn trọng: tắt bobbing, bụi, xoay token.

## Token đánh dấu

`assets/cards/token/` chứa 5 token tròn và `ngọc cổ.png`. Tên + công dụng đọc từ
`assets/cards/token/tokens.json`, khoá là tên file bỏ đuôi (`token1` ... `token5`, `ngọc cổ`).
Thả ảnh mới vào thư mục là token mới xuất hiện ở màn 3; sửa `name`/`rule` trong json là đổi caption.

Trang có 3 màn theo cuộn: giới thiệu (0) → bộ bài (1) → token (2). `body{height:300vh}`.
Khung hẹp thì token tự xếp thành 2 hàng (`tokenCols()`), không thu nhỏ tới mức không đọc được.

## Deploy GitHub Pages

Trang tĩnh: https://chunn241529.github.io/ngoccotulinh/

Pages không chạy được `server.js`, nên bản deploy đọc danh sách từ `data.json` (sinh sẵn).
App thử `api/cards` trước, 404 thì rơi xuống `data.json`, nên cùng một bundle chạy được cả
`npm start` (có API) lẫn Pages (tĩnh).

Sau khi thêm/sửa ảnh, tên lá trong `titles.json`, hay `token/tokens.json`:

```bash
npm run deploy      # = node build-data.mjs + npm run build
git add -A && git commit -m "update cards" && git push
```

Pages tự build lại sau ~1 phút. Không cần Actions.

QR vào trang: `qr.png` (656×656) và `qr.svg`, trỏ tới
`https://chunn241529.github.io/ngoccotulinh/`.
