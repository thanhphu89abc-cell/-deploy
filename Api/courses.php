<?php
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

ini_set('display_errors', 0);
error_reporting(0);
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Lỗi sập PHP: " . $error['message'] . " tại dòng " . $error['line']]);
        exit;
    }
});

/** @var mysqli $conn */
require_once dirname(__DIR__) . '/db_connect.php';

header('Content-Type: application/json; charset=utf-8');

$authHeader = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if (!$authHeader && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    $authHeader = isset($headers['Authorization']) ? $headers['Authorization'] : '';
}

if (!preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
    http_response_code(401);
    echo json_encode(["message" => "Không tìm thấy Token"]);
    exit();
}

try {
    $jwt = $matches[1];
    $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
    if (empty($secret_key)) throw new Exception("JWT Secret is not configured.");
    $decoded = JWT::decode($jwt, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    // 1. Lấy danh sách các bài học đã hoàn thành
    $completed_lessons = [];
    $prog_stmt = $conn->prepare("SELECT lesson_id FROM user_progress WHERE user_id = ?");
    if ($prog_stmt) {
        $prog_stmt->bind_param("i", $user_id);
        $prog_stmt->execute();
        $lesson_id = null;
        $prog_stmt->bind_result($lesson_id);
        while ($prog_stmt->fetch()) { $completed_lessons[] = $lesson_id; }
        $prog_stmt->close();
    }

    // 2. Lấy danh sách khóa học đã mua (current_step = 3)
    $unlocked_courses = [];
    $order_stmt = $conn->prepare("SELECT course_name FROM orders WHERE user_id = ? AND current_step = 3");
    if ($order_stmt) {
        $order_stmt->bind_param("i", $user_id);
        $order_stmt->execute();
        $course_name = null;
        $order_stmt->bind_result($course_name);
        while ($order_stmt->fetch()) { $unlocked_courses[] = $course_name; }
        $order_stmt->close();
    }

    // 3. Lấy dữ liệu khóa học
    $courses_res = $conn->query("SELECT * FROM courses");
    if (!$courses_res) jsonResponse(["message" => "Lỗi CSDL (courses)"], 500);
    $courses = [];
    $course_map = [];
    while ($c = $courses_res->fetch_assoc()) {
        $c['weeks'] = [];
        $c['lock_status'] = in_array($c['id'], $unlocked_courses) ? "UNLOCKED" : "LOCKED";
        $courses[] = $c;
        $course_map[$c['id']] = &$courses[count($courses) - 1];
    }
    $course_ids = array_keys($course_map);

    if (!empty($course_ids)) {
        $placeholders = implode(',', array_fill(0, count($course_ids), '?'));
        $types = str_repeat('s', count($course_ids));
        
        $weeks_stmt = $conn->prepare("SELECT * FROM course_weeks WHERE course_id IN ($placeholders) ORDER BY week_number ASC");
        $weeks_stmt->bind_param($types, ...$course_ids);
        $weeks_stmt->execute();
        $weeks_res = $weeks_stmt->get_result();
        $week_map = [];
        while ($w = $weeks_res->fetch_assoc()) {
            $w['items'] = [];
            $week_map[$w['id']] = $w;
        }
        $week_ids = array_keys($week_map);

        if (!empty($week_ids)) {
            $placeholders_lessons = implode(',', array_fill(0, count($week_ids), '?'));
            $types_lessons = str_repeat('i', count($week_ids));
            $lessons_stmt = $conn->prepare("SELECT * FROM lessons WHERE week_id IN ($placeholders_lessons) ORDER BY id ASC");
            $lessons_stmt->bind_param($types_lessons, ...$week_ids);
            $lessons_stmt->execute();
            $lessons_res = $lessons_stmt->get_result();
            while ($l = $lessons_res->fetch_assoc()) {
                if (isset($week_map[$l['week_id']])) {
                    $lesson = [
                        "id" => (string)$l['id'], "type" => $l['type'], "title" => $l['title'],
                        "duration" => $l['duration'], "videoSrc" => $l['video_url'], "description" => $l['description'],
                        "completed" => in_array($l['id'], $completed_lessons), "quiz" => null
                    ];
                    if (!empty($l['quiz_question'])) {
                        $lesson['quiz'] = [
                            "question" => $l['quiz_question'],
                            "options" => [ ["v" => "a", "t" => $l['quiz_option_a']], ["v" => "b", "t" => $l['quiz_option_b']] ],
                            "correct" => $l['quiz_correct_answer']
                        ];
                    }
                    $week_map[$l['week_id']]['items'][] = $lesson;
                }
            }
        }
        foreach ($week_map as $week) {
            if (isset($course_map[$week['course_id']])) {
                $course_map[$week['course_id']]['weeks'][] = $week;
            }
        }
    }
    echo json_encode(["courses" => $courses]);
} catch (Exception $e) {
    http_response_code(401);
    echo json_encode(["message" => "Phiên đăng nhập hết hạn: " . $e->getMessage()]);
}