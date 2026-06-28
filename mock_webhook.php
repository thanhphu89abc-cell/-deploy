<?php
require_once __DIR__ . '/db_connect.php';
header("Content-Type: application/json; charset=UTF-8");

// Tương tự như Python, webhook này chỉ trả về thông báo để học viên biết
// Admin sẽ là người duyệt đơn hàng để mở khóa (chuyển current_step = 3)
echo json_encode([
    "success" => true, 
    "message" => "Đã gửi yêu cầu xác nhận! Vui lòng chờ Admin duyệt để cấp quyền vào học."
]);