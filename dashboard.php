<?php
ob_start();
ini_set('display_errors', 0);
error_reporting(0);

register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (ob_get_level()) ob_clean();
        http_response_code(500);
        echo json_encode(["message" => "Lỗi hệ thống (dashboard): " . $error['message'] . " (Dòng " . $error['line'] . ")"]);
        exit;
    }
});

require_once __DIR__ . '/db_connect.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

header('Content-Type: application/json; charset=utf-8');

// 1. Lấy vé (Token) từ trình duyệt gửi lên

// [FIX] Sử dụng phương pháp lấy Header tương thích và ổn định hơn
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    $authHeader = $headers['Authorization'] ?? ($headers['authorization'] ?? '');
}

if (empty($authHeader)) {
    http_response_code(401);
    die(json_encode(["message" => "Chưa đăng nhập (Thiếu Token)"]));
}

$token = str_replace('Bearer ', '', $authHeader);
// KHÓA NÀY PHẢI GIỐNG HỆT BÊN LOGIN.PHP
$secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
if (empty($secret_key)) die(json_encode(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."]));

try {
    // 2. Giải mã Token
    $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    // 3. Lấy thông tin user (DÙNG FULLNAME thay vì username để không bị sập)
    $stmt = $conn->prepare("SELECT id, email, fullname, role, created_at FROM users WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $user = $result->fetch_assoc();

    if (!$user) {
        http_response_code(401);
        die(json_encode(["message" => "Tài khoản không tồn tại"]));
    }
    $user['created_at'] = isset($user['created_at']) ? date('d/m/Y', strtotime($user['created_at'])) : '---';

    // 4. Lấy danh sách đơn hàng (orders) để hiển thị trong Tài khoản
    $orders = [];
    // Dùng @ để bỏ qua lỗi nếu bảng orders chưa tồn tại hoặc sai cấu trúc
    $order_stmt = @$conn->prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC");
    if ($order_stmt) {
        $order_stmt->bind_param("i", $user_id);
        $order_stmt->execute();
        $order_res = $order_stmt->get_result();
        while($row = $order_res->fetch_assoc()) {
            $orders[] = $row;
        }
    }

    // Tính toán cấp bậc (Ranking) dựa trên số bài học đã hoàn thành
    $progress_stmt = @$conn->prepare("SELECT COUNT(*) as completed_count FROM user_progress WHERE user_id = ?");
    $rank = "Script Kiddie";
    $rank_color = "text-gray-500";
    if ($progress_stmt) {
        $progress_stmt->bind_param("i", $user_id);
        $progress_stmt->execute();
        $completed_count = $progress_stmt->get_result()->fetch_assoc()['completed_count'] ?? 0;
        
        if ($completed_count >= 50) { $rank = "Elite Hacker"; $rank_color = "text-red-500"; }
        elseif ($completed_count >= 20) { $rank = "White Hat"; $rank_color = "text-purple-500"; }
        elseif ($completed_count >= 5) { $rank = "Cyber Explorer"; $rank_color = "text-green-500"; }
    }
    $user['rank'] = $rank;
    $user['rank_color'] = $rank_color;

    // 5. Trả dữ liệu về cho coursera-script.js để hiển thị giao diện
    http_response_code(200);
    echo json_encode([
        "user" => $user,
        "orders" => $orders
    ]);

} catch (Exception $e) {
    // Bắt mọi lỗi liên quan đến Token hết hạn, sai khóa...
    http_response_code(401);
    echo json_encode(["message" => "Token hết hạn hoặc lỗi: " . $e->getMessage()]);
}
?>