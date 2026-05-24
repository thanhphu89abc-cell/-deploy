<?php
ob_start();
ini_set('display_errors', 0);
error_reporting(0);

require 'db_connect.php';
require_once 'vendor/autoload.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

header('Content-Type: application/json; charset=utf-8');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$pathInfo = $_SERVER['PATH_INFO'] ?? '/';
$method = $_SERVER['REQUEST_METHOD'];

$input = json_decode(file_get_contents('php://input'), true) ?? [];

function jsonResponse($data, $status = 200) {
    if (ob_get_level()) ob_clean();
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}

// ==============================================
// 1. CÁC API KHÔNG CẦN ĐĂNG NHẬP (LẤY LẠI MẬT KHẨU)
// ==============================================
if ($pathInfo === '/verify-otp' && $method === 'POST') {
    $email = $input['email'] ?? '';
    $otp = $input['otp'] ?? '';
    $stmt = $conn->prepare("SELECT * FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $record = $stmt->get_result()->fetch_assoc();
    
    if (!$record) jsonResponse(["message" => "Không tìm thấy yêu cầu cấp lại mật khẩu."], 400);
    if ($record['otp'] !== $otp) jsonResponse(["message" => "Mã xác nhận không đúng."], 400);
    if (strtotime($record['expires_at']) < time()) jsonResponse(["message" => "Mã xác nhận đã hết hạn."], 400);
    
    $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
    $reset_token = JWT::encode(['email' => $email, 'action' => 'reset_password', 'exp' => time() + 900], $secret_key, 'HS256');
    jsonResponse(["message" => "Xác thực OTP thành công.", "token" => $reset_token]);

} elseif ($pathInfo === '/reset-password' && $method === 'POST') {
    $email = $input['email'] ?? '';
    $new_password = $input['newPassword'] ?? '';
    $resetToken = $input['token'] ?? '';
    $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
    
    try {
        $payload = JWT::decode($resetToken, new Key($secret_key, 'HS256'));
        if ($payload->action !== 'reset_password' || $payload->email !== $email) {
            jsonResponse(["message" => "Phiên làm việc không hợp lệ."], 403);
        }
        $hashed = password_hash($new_password, PASSWORD_DEFAULT);
        $stmt = $conn->prepare("UPDATE users SET password_hash = ? WHERE email = ?");
        $stmt->bind_param("ss", $hashed, $email);
        $stmt->execute();
        $conn->query("DELETE FROM otp_codes WHERE email = '$email'");
        jsonResponse(["message" => "Đổi mật khẩu thành công!"]);
    } catch (Exception $e) {
        jsonResponse(["message" => "Thời gian đổi mật khẩu đã hết hạn."], 400);
    }
}

// ==============================================
// 2. KIỂM TRA ĐĂNG NHẬP CHO CÁC API TRONG TRANG HỌC
// ==============================================
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader && function_exists('apache_request_headers')) {
    $authHeader = apache_request_headers()['Authorization'] ?? '';
}
$token = '';
if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
    $token = $matches[1];
} elseif (isset($_GET['token'])) {
    $token = $_GET['token'];
}

if (empty($token)) {
    if (preg_match('#^/certificate/#', $pathInfo)) die("Vui lòng đăng nhập!");
    jsonResponse(["message" => "Vui lòng đăng nhập!"], 401);
}

$secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
try {
    $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;
    $user_fullname = $decoded->fullname ?? "Học viên";
} catch (Exception $e) {
    if (preg_match('#^/certificate/#', $pathInfo)) die("Token không hợp lệ hoặc đã hết hạn!");
    jsonResponse(["message" => "Token không hợp lệ hoặc đã hết hạn!"], 401);
}

// ==============================================
// 3. CÁC TÍNH NĂNG TƯƠNG TÁC
// ==============================================
if ($pathInfo === '/checkout' && $method === 'POST') {
    $course_id = $input['course_id'] ?? '';
    if (!$course_id) jsonResponse(["message" => "Thiếu mã khóa học!"], 400);

    $stmt = $conn->prepare("SELECT price FROM courses WHERE id = ?");
    $stmt->bind_param("s", $course_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $course = $res->fetch_assoc();
    $stmt->close();

    if (!$course) jsonResponse(["message" => "Khóa học không tồn tại!"], 404);

    $price_val = intval($course['price']);
    
    $stmt_check = $conn->prepare("SELECT id FROM orders WHERE user_id = ? AND course_name = ?");
    $stmt_check->bind_param("is", $user_id, $course_id);
    $stmt_check->execute();
    $stmt_check->bind_result($existing_id);
    if ($stmt_check->fetch()) {
        $order_id = $existing_id;
        $stmt_check->close();
    } else {
        $stmt_check->close();
        $stmt_ins = $conn->prepare("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (?, ?, ?, 1, NOW())");
        $stmt_ins->bind_param("isi", $user_id, $course_id, $price_val);
        $stmt_ins->execute();
        $order_id = $conn->insert_id;
        $stmt_ins->close();
    }

    $memo = "ATTT " . $order_id;
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$price_val}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    jsonResponse(["status" => "PENDING", "price" => $price_val, "memo" => $memo, "qr_url" => $qr_url, "order_id" => $order_id]);

} elseif ($pathInfo === '/progress' && $method === 'POST') {
    $lesson_id = $input['lesson_id'] ?? '';
    if (!$lesson_id) jsonResponse(["message" => "Thiếu mã bài học!"], 400);
    $stmt = $conn->prepare("INSERT IGNORE INTO user_progress (user_id, lesson_id) VALUES (?, ?)");
    $stmt->bind_param("ii", $user_id, $lesson_id);
    $stmt->execute();
    jsonResponse(["message" => "Đã lưu tiến độ."]);

} elseif ($pathInfo === '/review' && $method === 'POST') {
    $course_id = $input['course_id'] ?? '';
    $rating = $input['rating'] ?? 0;
    $comment = $input['comment'] ?? '';
    if (!$course_id || !$rating) jsonResponse(["message" => "Đánh giá không hợp lệ."], 400);
    $stmt = $conn->prepare("INSERT INTO course_reviews (user_id, course_id, rating, comment) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("isis", $user_id, $course_id, $rating, $comment);
    $stmt->execute();
    jsonResponse(["message" => "Cảm ơn bạn! Đánh giá đã được ghi nhận."]);

} elseif (preg_match('#^/certificate/([^/]+)$#', $pathInfo, $matches) && $method === 'GET') {
    $course_id = $matches[1];
    $stmt = $conn->prepare("SELECT title FROM courses WHERE id = ?");
    $stmt->bind_param("s", $course_id);
    $stmt->execute();
    $course = $stmt->get_result()->fetch_assoc();
    if (!$course) {
        if (ob_get_level()) ob_clean();
        http_response_code(404);
        die("Khóa học không tồn tại!");
    }
    
    $cert_id = "CERT-SEC-" . strtoupper($course_id) . "-" . date('Y');
    $date = date('d/m/Y');
    $title = htmlspecialchars($course['title']);
    $name = htmlspecialchars($user_fullname);
    
    header('Content-Type: text/html; charset=utf-8');
    if (ob_get_level()) ob_clean();
    echo <<<HTML
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Chứng chỉ - {$name}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Sans+Pro:wght@400;700;900&display=swap');
            body { margin: 0; padding: 0; background: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: 'Source Sans Pro', sans-serif; }
            .certificate-wrapper { background: white; width: 1000px; height: 700px; position: relative; padding: 40px; box-sizing: border-box; box-shadow: 0 20px 50px rgba(0,0,0,0.15); border-radius: 4px; overflow: hidden; }
            .certificate-border { position: absolute; inset: 20px; border: 2px solid #0056D2; outline: 8px solid #f0f4f8; outline-offset: -12px; pointer-events: none; }
            .certificate-content { position: relative; z-index: 10; height: 100%; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 40px 60px; box-sizing: border-box; }
            .logo { font-size: 32px; font-weight: 900; color: #0056D2; letter-spacing: -1px; margin-bottom: 30px; text-transform: lowercase; }
            .title { font-family: 'Playfair Display', serif; font-size: 54px; font-weight: 700; color: #1e293b; margin-bottom: 10px; letter-spacing: 1px; }
            .subtitle { font-size: 16px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 40px; }
            .presented-to { font-size: 18px; color: #475569; margin-bottom: 15px; font-style: italic; }
            .student-name { font-family: 'Playfair Display', serif; font-size: 48px; font-weight: 700; color: #0056D2; border-bottom: 2px solid #cbd5e1; padding-bottom: 10px; min-width: 500px; margin-bottom: 30px; }
            .course-text { font-size: 18px; color: #475569; margin-bottom: 15px; }
            .course-name { font-size: 28px; font-weight: 700; color: #1e293b; margin-bottom: 50px; line-height: 1.3; }
            .footer { width: 100%; display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; }
            .cert-info { text-align: left; font-size: 14px; color: #64748b; }
            .cert-info strong { color: #334155; }
            .signature-block { text-align: center; }
            .signature-line { width: 200px; border-bottom: 2px solid #334155; margin-bottom: 8px; }
            .signature-title { font-size: 14px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
            .seal { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); width: 120px; height: 120px; background: radial-gradient(circle, #fbbf24 0%, #d97706 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; text-align: center; font-size: 12px; box-shadow: 0 4px 15px rgba(217, 119, 6, 0.4); border: 4px dashed rgba(255,255,255,0.5); }
            .seal-text { font-family: 'Playfair Display', serif; letter-spacing: 1px; line-height: 1.4; }
            .btn-print { position: fixed; bottom: 30px; right: 30px; background: #0056D2; color: white; padding: 15px 30px; border-radius: 50px; font-weight: bold; font-size: 16px; cursor: pointer; border: none; box-shadow: 0 10px 25px rgba(0,86,210,0.3); transition: all 0.3s; z-index: 100; }
            .btn-print:hover { transform: translateY(-2px); box-shadow: 0 15px 30px rgba(0,86,210,0.4); }
            @media print { 
                body { background: white; margin: 0; padding: 0; align-items: flex-start; justify-content: flex-start; } 
                .certificate-wrapper { box-shadow: none; border: none; width: 100%; height: 100vh; padding: 20px; border-radius: 0; page-break-after: avoid; } 
                .btn-print { display: none; } 
                @page { size: landscape; margin: 0; }
            }
        </style>
    </head>
    <body>
        <button class="btn-print" onclick="window.print()"><svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg> Xuất PDF / In chứng chỉ</button>
        <div class="certificate-wrapper">
            <div class="certificate-border"></div>
            <div class="certificate-content">
                <div class="logo">coursera</div>
                <div class="title">Chứng Nhận Hoàn Thành</div>
                <div class="subtitle">Advanced Information Security Program</div>
                
                <div class="presented-to">Chứng nhận này được trân trọng trao cho</div>
                <div class="student-name">{$name}</div>
                
                <div class="course-text">Để ghi nhận việc đã hoàn thành xuất sắc lộ trình đào tạo:</div>
                <div class="course-name">{$title}</div>
                
                <div class="seal">
                    <div class="seal-text">COURSERA<br>CERTIFIED<br>2024</div>
                </div>
                
                <div class="footer">
                    <div class="cert-info">
                        <p style="margin:0 0 5px 0;">Mã chứng chỉ: <strong>{$cert_id}</strong></p>
                        <p style="margin:0;">Ngày cấp: <strong>{$date}</strong></p>
                    </div>
                    <div class="signature-block">
                        <div class="signature-line"></div>
                        <div class="signature-title">Giám đốc Đào tạo</div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    HTML;
    exit();

} elseif ($pathInfo === '/submit-flag' && $method === 'POST') {
    $lesson_id = $input['lesson_id'] ?? '';
    $flag = trim($input['flag'] ?? '');
    
    $stmt = $conn->prepare("SELECT flag FROM lessons WHERE id = ?");
    $stmt->bind_param("i", $lesson_id);
    $stmt->execute();
    $lesson = $stmt->get_result()->fetch_assoc();
    if (!$lesson || empty($lesson['flag'])) jsonResponse(["message" => "Bài học này không có cấu hình CTF Flag!"], 400);
    
    if ($flag === $lesson['flag']) {
        $stmt = $conn->prepare("INSERT IGNORE INTO user_progress (user_id, lesson_id) VALUES (?, ?)");
        $stmt->bind_param("ii", $user_id, $lesson_id);
        $stmt->execute();
        jsonResponse(["success" => true, "message" => "Chính xác hoàn toàn! Tiến trình module đã được tích xanh."]);
    } else {
        jsonResponse(["success" => false, "message" => "Sai cấu trúc Flag! Chuỗi mật mã băm trích xuất không trùng khớp."]);
    }
} elseif ($pathInfo === '/mock-webhook' && $method === 'POST') {
    $order_id = $input['order_id'] ?? '';
    if (!$order_id) jsonResponse(["message" => "Thiếu mã đơn hàng!"], 400);
    $conn->query("UPDATE orders SET current_step = 3 WHERE id = " . intval($order_id) . " AND user_id = $user_id");
    jsonResponse(["success" => true, "message" => "Thanh toán thành công. Khóa học đã được mở khóa!"]);
} elseif ($pathInfo === '/cart-checkout' && $method === 'POST') {
    $course_ids = $input['course_ids'] ?? [];
    if (empty($course_ids)) jsonResponse(["message" => "Giỏ hàng trống!"], 400);

    $total_price = 0;
    $order_ids = [];
    
    $placeholders = implode(',', array_fill(0, count($course_ids), '?'));
    $stmt = $conn->prepare("SELECT id, title, price FROM courses WHERE id IN ($placeholders)");
    $types = str_repeat('s', count($course_ids));
    $stmt->bind_param($types, ...$course_ids);
    $stmt->execute();
    $res = $stmt->get_result();
    
    $courses = [];
    while ($row = $res->fetch_assoc()) {
        $courses[] = $row;
    }
    $stmt->close();

    if (empty($courses)) jsonResponse(["message" => "Khóa học không tồn tại!"], 404);

    foreach ($courses as $c) {
        $total_price += intval($c['price']);
        
        $stmt_check = $conn->prepare("SELECT id FROM orders WHERE user_id = ? AND course_name = ?");
        $stmt_check->bind_param("is", $user_id, $c['id']);
        $stmt_check->execute();
        $stmt_check->bind_result($existing_id);
        if ($stmt_check->fetch()) {
            $order_ids[] = $existing_id;
        } else {
            $stmt_check->close();
            $stmt_ins = $conn->prepare("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (?, ?, ?, 1, NOW())");
            $price_val = intval($c['price']);
            $stmt_ins->bind_param("isi", $user_id, $c['id'], $price_val);
            $stmt_ins->execute();
            $order_ids[] = $conn->insert_id;
            $stmt_ins->close();
        }
        if(isset($stmt_check) && $stmt_check instanceof mysqli_stmt) { @$stmt_check->close(); }
    }

    $cart_order_id = "CART_" . implode("_", $order_ids);
    $memo = "ATTT " . $user_id . " CART";
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$total_price}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    jsonResponse(["status" => "PENDING", "price" => $total_price, "memo" => $memo, "qr_url" => $qr_url, "order_id" => $cart_order_id]);

} elseif ($pathInfo === '/mock-webhook-cart' && $method === 'POST') {
    $order_id = $input['order_id'] ?? '';
    if (strpos($order_id, 'CART_') === 0) {
        $ids_str = str_replace("CART_", "", $order_id);
        $oids = explode("_", $ids_str);
        foreach ($oids as $oid) {
            if ($oid) {
                $conn->query("UPDATE orders SET current_step = 3 WHERE id = " . intval($oid) . " AND user_id = $user_id");
            }
        }
        jsonResponse(["success" => true, "message" => "Thanh toán giỏ hàng thành công. Các khóa học đã mở khóa!"]);
    } else {
        jsonResponse(["message" => "Mã đơn hàng không hợp lệ!"], 400);
    }
} elseif ($pathInfo === '/chatbot' && $method === 'POST') {
    $message = trim($input['message'] ?? '');
    
    if (empty($message)) {
        jsonResponse(["reply" => "Tôi có thể giúp gì cho bạn hôm nay?"]);
    }

    // DÁN MÃ API KEY CỦA GOOGLE GEMINI VÀO ĐÂY
    $api_key = 'AIzaSyC3lrJN0s11XsN4m67HSqEOvRrO7t6xlnE';
    
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' . trim($api_key);
    
    // Cấu hình tính cách cho AI (Prompt Engineering)
    $system_prompt = "Bạn là CyberAI, một trợ lý học thuật chuyên gia về An toàn thông tin của nền tảng Coursera Advanced. Hãy trả lời câu hỏi sau một cách ngắn gọn, thân thiện, dễ hiểu và bằng tiếng Việt. QUAN TRỌNG: KHÔNG sử dụng ký tự Markdown (như *, #, **), chỉ sử dụng dấu xuống dòng để tách đoạn.\n\nCâu hỏi của học viên: " . $message;
    
    $data = [
        "contents" => [ ["parts" => [ ["text" => $system_prompt] ] ] ],
        "generationConfig" => [ "temperature" => 0.7, "maxOutputTokens" => 800 ]
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // Bỏ qua lỗi SSL trên môi trường XAMPP cục bộ
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($http_code == 200 && $response) {
        $result = json_decode($response, true);
        if (isset($result['candidates'][0]['content']['parts'][0]['text'])) {
            jsonResponse(["reply" => trim($result['candidates'][0]['content']['parts'][0]['text'])]);
        }
    }
    
    // Nếu có lỗi, trích xuất lỗi chi tiết từ Google để hiển thị
    $error_msg = "Mã lỗi: $http_code";
    if ($response) {
        $res_json = json_decode($response, true);
        if (isset($res_json['error']['message'])) {
            $error_msg .= " - " . $res_json['error']['message'];
        }
    }
    jsonResponse(["reply" => "Hệ thống AI gặp sự cố ($error_msg). Bạn vui lòng kiểm tra lại cấu hình."]);
}

jsonResponse(["message" => "Endpoint không hợp lệ."], 404);
?>